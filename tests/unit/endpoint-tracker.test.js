/**
 * Persistence tests for the observed-endpoint tracker.
 * A "service worker restart" is simulated with jest.resetModules(): the fresh
 * module starts with empty memory while the mocked storage keeps its data.
 */

const STORAGE_KEY = 'apqObservedEndpoints';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function freshServiceWorker() {
  jest.resetModules();
  return {
    tracker: require('../../js/sw/endpoint-tracker.js'),
    loader: require('../../js/sw/schema-loader.js'),
  };
}

function lastPersistedSnapshot() {
  const calls = chrome.storage.local.set.mock.calls;
  return calls[calls.length - 1][0][STORAGE_KEY];
}

describe('Endpoint Tracker persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
    chrome.storage.local.get.mockImplementation((_keys, cb) => cb({}));
    chrome.storage.local.set.mockImplementation((_items, cb) => cb && cb());
  });

  test('should persist recorded endpoints with their captured headers', async () => {
    const { tracker } = freshServiceWorker();

    tracker.recordEndpoint(1, 'https://api.other.com/v2/gql?op=GetUsers#frag', [
      { name: 'client-info', value: 'web' },
    ]);
    await flush();

    expect(lastPersistedSnapshot()).toEqual({
      1: [
        { url: 'https://api.other.com/v2/gql', headers: [{ name: 'client-info', value: 'web' }] },
      ],
    });
  });

  test('should restore observations from storage after a service worker restart', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) =>
      cb({
        [STORAGE_KEY]: {
          1: [{ url: 'https://api.other.com/v2/gql', headers: [{ name: 'x-csrf', value: 'tok' }] }],
        },
      })
    );
    const { tracker } = freshServiceWorker();

    expect(tracker.getObservedEndpoints(1)).toEqual([]);
    await tracker.ensureEndpointsLoaded();
    expect(tracker.getObservedEndpoints(1)).toEqual(['https://api.other.com/v2/gql']);
    expect(tracker.getObservedEndpointEntries(1)).toEqual([
      { url: 'https://api.other.com/v2/gql', headers: [{ name: 'x-csrf', value: 'tok' }] },
    ]);
  });

  test('should migrate entries persisted as plain URL strings', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) =>
      cb({ [STORAGE_KEY]: { 1: ['https://legacy.com/graphql'] } })
    );
    const { tracker } = freshServiceWorker();

    await tracker.ensureEndpointsLoaded();

    expect(tracker.getObservedEndpointEntries(1)).toEqual([
      { url: 'https://legacy.com/graphql', headers: [] },
    ]);
  });

  test('should keep endpoints recorded before the stored snapshot finishes loading', async () => {
    let resolveGet;
    chrome.storage.local.get.mockImplementation((_keys, cb) => {
      resolveGet = cb;
    });
    const { tracker } = freshServiceWorker();

    tracker.recordEndpoint(1, 'https://live.com/graphql');
    resolveGet({ [STORAGE_KEY]: { 1: [{ url: 'https://stored.com/graphql', headers: [] }] } });
    await tracker.ensureEndpointsLoaded();
    await flush();

    const endpoints = tracker.getObservedEndpoints(1);
    expect(endpoints).toContain('https://live.com/graphql');
    expect(endpoints).toContain('https://stored.com/graphql');
    expect(lastPersistedSnapshot()[1].map((entry) => entry.url)).toEqual(
      expect.arrayContaining(['https://live.com/graphql', 'https://stored.com/graphql'])
    );
  });

  test('should fill in headers from a later capture when the first had none', async () => {
    const { tracker } = freshServiceWorker();

    tracker.recordEndpoint(1, 'https://a.com/graphql');
    tracker.recordEndpoint(1, 'https://a.com/graphql', [{ name: 'client-info', value: 'web' }]);
    await flush();

    expect(tracker.getObservedEndpointEntries(1)).toEqual([
      { url: 'https://a.com/graphql', headers: [{ name: 'client-info', value: 'web' }] },
    ]);
  });

  test('should clear stored entries for a tab even on a fresh service worker', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) =>
      cb({
        [STORAGE_KEY]: {
          1: [{ url: 'https://a.com/graphql', headers: [] }],
          2: [{ url: 'https://b.com/graphql', headers: [] }],
        },
      })
    );
    const { tracker } = freshServiceWorker();

    tracker.clearObservedEndpoints(1);
    await flush();

    expect(tracker.getObservedEndpoints(1)).toEqual([]);
    const persisted = lastPersistedSnapshot();
    expect(persisted[1]).toBeUndefined();
    expect(persisted[2]).toEqual([{ url: 'https://b.com/graphql', headers: [] }]);
  });

  test('should prefer chrome.storage.session when available', async () => {
    chrome.storage.session = {
      get: jest.fn((_keys, cb) => cb({})),
      set: jest.fn((_items, cb) => cb && cb()),
    };
    try {
      const { tracker } = freshServiceWorker();

      tracker.recordEndpoint(1, 'https://a.com/graphql');
      await flush();

      expect(chrome.storage.session.set).toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    } finally {
      delete chrome.storage.session;
    }
  });

  test('loadSchema should introspect endpoints persisted before a service worker restart', async () => {
    chrome.storage.local.get.mockImplementation((_keys, cb) =>
      cb({
        [STORAGE_KEY]: {
          7: [
            {
              url: 'https://api.cross-origin.com/gql',
              headers: [{ name: 'client-info', value: 'web' }],
            },
          ],
        },
      })
    );
    const { loader } = freshServiceWorker();

    global.fetch = jest.fn((url) => {
      if (url !== 'https://api.cross-origin.com/gql') {
        return Promise.reject(new Error('refused'));
      }
      return Promise.resolve({
        json: () => Promise.resolve({ data: { __schema: { types: [] } } }),
      });
    });

    try {
      const result = await loader.loadSchema({ tabId: 7, tabUrl: 'https://app.test.com/' });

      expect(result.endpoint).toBe('https://api.cross-origin.com/gql');
      expect(result.introspection).toEqual({ __schema: { types: [] } });
      // Introspected directly with the captured headers — no probe round trip
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][1].headers['client-info']).toBe('web');
    } finally {
      delete global.fetch;
    }
  });
});
