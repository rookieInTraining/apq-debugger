import {
  isAnalyticsConfigured,
  getConsent,
  setConsent,
  trackEvent,
} from '../../js/sw/analytics.js';
import { handleMessage } from '../../js/sw/messaging.js';
import { handleFetchRequestPaused } from '../../js/sw/interceptor.js';
import { attachedTabs } from '../../js/sw/debugger-manager.js';
import { initPanelPresence } from '../../js/sw/panel-presence.js';
import { initBreakpoints, setBreakpoints, setDebugMode } from '../../js/sw/breakpoints.js';
import { holdRequest, dropTab } from '../../js/sw/pause-queue.js';
import { recordEndpoint, clearObservedEndpoints } from '../../js/sw/endpoint-tracker.js';
import { setPassiveMode } from '../../js/sw/hash-registry.js';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  ANALYTICS_CLIENT_ID_STORAGE_KEY,
  ANALYTICS_SESSION_STORAGE_KEY,
  GA_ENDPOINT,
} from '../../js/shared/constants.js';

const UUID = '11111111-2222-4333-8444-555555555555';
const flush = () => new Promise((r) => setTimeout(r, 30));
const send = (message) => new Promise((resolve) => handleMessage(message, {}, resolve));

let localStore;
let sessionStore;

/** In-memory chrome.storage area backed by a plain object. */
function fakeArea(area, getStore) {
  area.get.mockImplementation((keys, cb) => {
    chrome.runtime.lastError = null;
    const store = getStore();
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
    const out = {};
    list.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
    });
    cb(out);
  });
  area.set.mockImplementation((items, cb) => {
    chrome.runtime.lastError = null;
    Object.assign(getStore(), items);
    cb && cb();
  });
  area.remove.mockImplementation((keys, cb) => {
    chrome.runtime.lastError = null;
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete getStore()[k]);
    cb && cb();
  });
}

/** Parsed bodies of every fetch call made so far. */
const sentBodies = () =>
  global.fetch.mock.calls
    .filter((c) => String(c[0]).startsWith(GA_ENDPOINT))
    .map((c) => JSON.parse(c[1].body));
const sentEvents = () => sentBodies().flatMap((b) => b.events);

function configure() {
  global.__GA_MEASUREMENT_ID__ = 'G-TEST';
  global.__GA_API_SECRET__ = 'S';
}

function unconfigure() {
  delete global.__GA_MEASUREMENT_ID__;
  delete global.__GA_API_SECRET__;
}

beforeEach(() => {
  jest.clearAllMocks();
  chrome.runtime.lastError = null;
  localStore = {};
  sessionStore = {};
  fakeArea(chrome.storage.local, () => localStore);
  fakeArea(chrome.storage.session, () => sessionStore);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  crypto.randomUUID.mockReturnValue(UUID);
  chrome.runtime.sendMessage.mockImplementation((_msg, cb) => cb && cb(null));
  chrome.runtime.getManifest.mockReturnValue({ version: '4.0.0' });
  chrome.runtime.getPlatformInfo.mockImplementation((cb) => cb({ os: 'win' }));
  chrome.i18n.getUILanguage.mockReturnValue('en-US');
  configure();
});

afterEach(() => {
  unconfigure();
});

describe('analytics: not configured', () => {
  beforeEach(unconfigure);

  test('trackEvent never calls fetch', async () => {
    localStore[ANALYTICS_CONSENT_STORAGE_KEY] = 'granted';
    await trackEvent('panel_open');
    expect(isAnalyticsConfigured()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('setConsent("granted") does not send', async () => {
    await setConsent('granted');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('getAnalyticsState reports configured: false', async () => {
    const response = await send({ getAnalyticsState: true });
    expect(response).toEqual({ status: 'SUCCESS', configured: false, consent: null });
  });

  test('only the secret missing still counts as unconfigured', async () => {
    global.__GA_MEASUREMENT_ID__ = 'G-TEST';
    expect(isAnalyticsConfigured()).toBe(false);
  });
});

describe('analytics: consent', () => {
  test('consent unset: no fetch', async () => {
    expect(await getConsent()).toBeNull();
    await trackEvent('panel_open');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('consent denied: no fetch', async () => {
    await setConsent('denied');
    expect(await getConsent()).toBe('denied');
    await trackEvent('panel_open');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('setConsent("granted") sends analytics_opt_in with the stored client id', async () => {
    await setConsent('granted');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(`${GA_ENDPOINT}?measurement_id=G-TEST&api_secret=S`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(localStore[ANALYTICS_CLIENT_ID_STORAGE_KEY]).toBe(UUID);
    expect(body.client_id).toBe(UUID);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].name).toBe('analytics_opt_in');
    expect(body.user_properties).toEqual({
      extension_version: { value: '4.0.0' },
      browser_major: { value: expect.any(String) },
      os: { value: 'win' },
      ui_language: { value: 'en-US' },
    });
  });

  test('setConsent broadcasts ANALYTICS_UPDATED without a tabId', async () => {
    await setConsent('denied');
    const msg = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
    expect(msg).toContainEqual({ status: 'ANALYTICS_UPDATED', consent: 'denied' });
    expect(msg[0]).not.toHaveProperty('tabId');
  });

  test('setConsent("denied") after granted removes ids and stops sending', async () => {
    await setConsent('granted');
    await trackEvent('panel_open');
    expect(sessionStore[ANALYTICS_SESSION_STORAGE_KEY]).toBeDefined();
    global.fetch.mockClear();

    await setConsent('denied');
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ANALYTICS_CLIENT_ID_STORAGE_KEY,
      expect.any(Function)
    );
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(
      ANALYTICS_SESSION_STORAGE_KEY,
      expect.any(Function)
    );
    expect(localStore[ANALYTICS_CLIENT_ID_STORAGE_KEY]).toBeUndefined();
    expect(sessionStore[ANALYTICS_SESSION_STORAGE_KEY]).toBeUndefined();

    await trackEvent('panel_open');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('analytics: sending', () => {
  beforeEach(async () => {
    await setConsent('granted');
    global.fetch.mockClear();
  });

  test('disallowed param values are dropped and no traffic data is sent', async () => {
    await trackEvent('copy', { what: 'GetCart', url: 'https://api.test/graphql' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const raw = global.fetch.mock.calls[0][1].body;
    const body = JSON.parse(raw);
    expect(Object.keys(body.events[0].params).sort()).toEqual([
      'engagement_time_msec',
      'session_id',
    ]);
    expect(body.events[0].params.engagement_time_msec).toBe(100);
    expect(raw).not.toMatch(/GetCart/);
    expect(raw).not.toMatch(/http/);
    expect(raw).not.toMatch(/graphql/);
  });

  test('allowlisted params are sent', async () => {
    await trackEvent('copy', { what: 'query' });
    expect(sentEvents()[0].params.what).toBe('query');
  });

  test('unknown event names are not sent', async () => {
    await trackEvent('page_view');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetch rejection is swallowed', async () => {
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    global.fetch.mockRejectedValue(new Error('offline'));
    await expect(trackEvent('panel_open')).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  test('non-2xx is swallowed', async () => {
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(trackEvent('panel_open')).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  test('client id and session id are reused across calls', async () => {
    await trackEvent('panel_open');
    await trackEvent('export_history');
    const bodies = sentBodies();
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(bodies[0].client_id).toBe(UUID);
    expect(bodies[1].client_id).toBe(UUID);
    expect(bodies[0].events[0].params.session_id).toBe(bodies[1].events[0].params.session_id);
  });
});

describe('analytics: messages', () => {
  test('getAnalyticsState / setAnalyticsConsent', async () => {
    expect(await send({ getAnalyticsState: true })).toEqual({
      status: 'SUCCESS',
      configured: true,
      consent: null,
    });
    expect(await send({ setAnalyticsConsent: 'granted' })).toEqual({
      status: 'SUCCESS',
      configured: true,
      consent: 'granted',
    });
  });

  test('trackEvent message is routed', async () => {
    await setConsent('granted');
    global.fetch.mockClear();
    expect(await send({ trackEvent: { name: 'panel_open' } })).toEqual({ status: 'SUCCESS' });
    await flush();
    expect(sentEvents().map((e) => e.name)).toEqual(['panel_open']);
  });

  test('invalid analytics messages are rejected', async () => {
    for (const message of [
      { trackEvent: 'x' },
      { trackEvent: { name: 1 } },
      { trackEvent: { name: 'copy', params: 'x' } },
      { setAnalyticsConsent: 'maybe' },
      { getAnalyticsState: 'yes' },
    ]) {
      expect(await send(message)).toEqual(expect.objectContaining({ status: 'ERROR' }));
    }
  });

  test('ANALYTICS_UPDATED broadcasts are ignored', () => {
    const sendResponse = jest.fn();
    expect(handleMessage({ status: 'ANALYTICS_UPDATED' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('analytics: service-worker emit points', () => {
  let onConnect;

  beforeAll(() => {
    initPanelPresence(() => {});
    const calls = chrome.runtime.onConnect.addListener.mock.calls;
    onConnect = calls[calls.length - 1][0];
  });

  beforeEach(async () => {
    attachedTabs.clear();
    chrome.debugger.attach.mockImplementation((_d, _v, cb) => {
      chrome.runtime.lastError = null;
      cb();
    });
    chrome.debugger.sendCommand.mockImplementation((_d, _m, _p, cb) => {
      chrome.runtime.lastError = null;
      cb && cb();
    });
    chrome.debugger.getTargets.mockImplementation((cb) => cb([]));
    chrome.tabs.get.mockImplementation((tabId, cb) => {
      chrome.runtime.lastError = null;
      cb({ id: tabId, url: 'https://example.com' });
    });
    await setPassiveMode(false);
    await setConsent('granted');
    global.fetch.mockClear();
  });

  test('attaching from the panel emits interception_start', async () => {
    const response = await send({ patterns: [{ urlPattern: '*graphql*' }], tabId: 42 });
    expect(response.status).toBe('SUCCESS');
    await flush();
    const event = sentEvents().find((e) => e.name === 'interception_start');
    expect(event.params).toEqual(expect.objectContaining({ mode: 'active', trigger: 'panel' }));
  });

  test('a held request emits breakpoint_hit', async () => {
    onConnect({ name: 'gql-panel:7', onDisconnect: { addListener: () => {} } });
    await initBreakpoints();
    await setBreakpoints([{ name: 'GetCart', enabled: true }]);
    await setDebugMode(7, true);

    handleFetchRequestPaused(
      { tabId: 7 },
      {
        requestId: 'h1',
        request: {
          method: 'POST',
          url: 'https://api.test/graphql',
          hasPostData: true,
          postData: JSON.stringify({ query: 'query GetCart { a }', operationName: 'GetCart' }),
          headers: {},
        },
      }
    );
    await flush();
    const event = sentEvents().find((e) => e.name === 'breakpoint_hit');
    expect(event.params).toEqual(expect.objectContaining({ reason: 'breakpoint', mode: 'active' }));
    expect(JSON.stringify(sentBodies())).not.toMatch(/GetCart/);
  });

  const eventNamed = (name) => sentEvents().find((e) => e.name === name);

  test('breakpoint messages emit their events', async () => {
    await send({ setDebugMode: true, tabId: 7 });
    await send({ setPauseNext: true, tabId: 7 });
    await send({ setPauseNext: false, tabId: 7 });
    await send({ resumeAllPaused: true, tabId: 7 });
    await flush();
    expect(eventNamed('debug_mode_set').params.on).toBe('yes');
    expect(sentEvents().filter((e) => e.name === 'pause_next_armed')).toHaveLength(1);
    expect(eventNamed('paused_resume_all')).toBeDefined();
  });

  describe('paused_resume / paused_fail', () => {
    const item = (id) => ({
      id,
      networkId: `net-${id}`,
      tabId: 7,
      url: 'https://api.test/graphql',
      method: 'POST',
      heldAt: 1,
      reason: 'breakpoint',
      state: 'paused',
      body: { query: 'query A { a }', operationName: 'A' },
      rawHeaders: {},
      operations: [
        {
          index: 0,
          operationName: 'A',
          query: 'query A { a }',
          querySource: 'request',
          variables: null,
          hash: '',
          isHashOnly: false,
        },
      ],
    });

    afterEach(async () => {
      await dropTab(7);
    });

    test('unedited resume reports edited: no', async () => {
      await holdRequest(item('p1'));
      await send({ resumePaused: 'p1', tabId: 7, edits: {} });
      await flush();
      expect(eventNamed('paused_resume').params.edited).toBe('no');
    });

    test('resume with a changed query reports edited: yes', async () => {
      await holdRequest(item('p2'));
      await send({
        resumePaused: 'p2',
        tabId: 7,
        edits: { operations: [{ index: 0, query: 'query A { b }' }] },
      });
      await flush();
      expect(eventNamed('paused_resume').params.edited).toBe('yes');
    });

    test('fail emits paused_fail', async () => {
      await holdRequest(item('p3'));
      await send({ failPaused: 'p3', tabId: 7 });
      await flush();
      expect(eventNamed('paused_fail')).toBeDefined();
    });
  });

  test('Chrome infobar cancel emits interception_stop with trigger chrome', async () => {
    global.self = { addEventListener: jest.fn() };
    jest.isolateModules(() => require('../../js/sw/index.js'));
    const calls = chrome.debugger.onDetach.addListener.mock.calls;
    const onDetach = calls[calls.length - 1][0];
    await flush();
    global.fetch.mockClear();
    onDetach({ tabId: 7 }, 'canceled_by_user');
    await flush();
    expect(eventNamed('interception_stop').params.trigger).toBe('chrome');
    delete global.self;
  });

  describe('schema_load source', () => {
    afterEach(() => clearObservedEndpoints(7));

    test('manual when a URL is given', async () => {
      await send({ loadSchema: true, tabId: 7, url: 'https://api.test/graphql' });
      await flush();
      expect(eventNamed('schema_load').params).toEqual(
        expect.objectContaining({ result: 'error', source: 'manual' })
      );
    });

    test('observed when the loaded endpoint came from traffic', async () => {
      recordEndpoint(7, 'https://api.test/graphql');
      global.fetch.mockImplementation(async (url) =>
        String(url).startsWith(GA_ENDPOINT)
          ? { ok: true, status: 204 }
          : { ok: true, status: 200, json: async () => ({ data: { __schema: {} } }) }
      );
      const response = await send({ loadSchema: true, tabId: 7 });
      await flush();
      expect(response.status).toBe('SUCCESS');
      expect(eventNamed('schema_load').params).toEqual(
        expect.objectContaining({ result: 'success', source: 'observed' })
      );
      expect(JSON.stringify(sentBodies())).not.toMatch(/api\.test/);
    });

    test('guessed when nothing was observed', async () => {
      await send({ loadSchema: true, tabId: 7 });
      await flush();
      expect(eventNamed('schema_load').params).toEqual(
        expect.objectContaining({ result: 'error', source: 'guessed' })
      );
    });
  });
});
