import {
  buildOriginCandidates,
  probeEndpoint,
  fetchIntrospection,
  loadSchema,
} from '../../js/sw/schema-loader.js';
import {
  recordEndpoint,
  getObservedEndpoints,
  clearObservedEndpoints,
} from '../../js/sw/endpoint-tracker.js';

function jsonResponse(body) {
  return Promise.resolve({ json: () => Promise.resolve(body) });
}

describe('Endpoint Tracker', () => {
  afterEach(() => {
    clearObservedEndpoints(1);
    clearObservedEndpoints(2);
  });

  test('should record and normalize endpoint URLs', () => {
    recordEndpoint(1, 'https://api.test.com/graphql?op=GetUsers#frag');
    expect(getObservedEndpoints(1)).toEqual(['https://api.test.com/graphql']);
  });

  test('should deduplicate endpoints', () => {
    recordEndpoint(1, 'https://api.test.com/graphql');
    recordEndpoint(1, 'https://api.test.com/graphql?x=1');
    expect(getObservedEndpoints(1)).toHaveLength(1);
  });

  test('should track endpoints per tab', () => {
    recordEndpoint(1, 'https://a.com/graphql');
    recordEndpoint(2, 'https://b.com/graphql');
    expect(getObservedEndpoints(1)).toEqual(['https://a.com/graphql']);
    expect(getObservedEndpoints(2)).toEqual(['https://b.com/graphql']);
  });

  test('should ignore invalid input', () => {
    recordEndpoint(1, 'not-a-url');
    recordEndpoint(1, null);
    recordEndpoint('x', 'https://a.com/graphql');
    expect(getObservedEndpoints(1)).toEqual([]);
  });

  test('should clear endpoints for a tab', () => {
    recordEndpoint(1, 'https://a.com/graphql');
    clearObservedEndpoints(1);
    expect(getObservedEndpoints(1)).toEqual([]);
  });
});

describe('Schema Loader', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearObservedEndpoints(1);
    delete global.fetch;
  });

  describe('buildOriginCandidates', () => {
    test('should guess common GraphQL paths on the page origin', () => {
      const candidates = buildOriginCandidates('https://app.test.com/dashboard');
      expect(candidates).toContain('https://app.test.com/graphql');
      expect(candidates).toContain('https://app.test.com/api/graphql');
    });

    test('should skip origin guesses for invalid tab URLs', () => {
      expect(buildOriginCandidates('chrome://extensions')).toEqual([]);
    });

    test('should exclude endpoints that were already tried', () => {
      const candidates = buildOriginCandidates('https://app.test.com/', [
        'https://app.test.com/graphql',
      ]);
      expect(candidates).not.toContain('https://app.test.com/graphql');
      expect(candidates).toContain('https://app.test.com/api/graphql');
    });
  });

  describe('probeEndpoint', () => {
    test('should qualify on data.__typename', async () => {
      global.fetch.mockReturnValue(jsonResponse({ data: { __typename: 'Query' } }));
      await expect(probeEndpoint('https://a.com/graphql')).resolves.toBe(true);
    });

    test('should qualify on GraphQL-shaped errors', async () => {
      global.fetch.mockReturnValue(
        jsonResponse({ errors: [{ message: 'PersistedQueryNotFound' }] })
      );
      await expect(probeEndpoint('https://a.com/graphql')).resolves.toBe(true);
    });

    test('should reject non-GraphQL JSON', async () => {
      global.fetch.mockReturnValue(jsonResponse({ hello: 'world' }));
      await expect(probeEndpoint('https://a.com/api')).resolves.toBe(false);
    });

    test('should reject on network errors', async () => {
      global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(probeEndpoint('https://a.com/graphql')).resolves.toBe(false);
    });

    test('should reject on non-JSON responses', async () => {
      global.fetch.mockResolvedValue({ json: () => Promise.reject(new Error('not json')) });
      await expect(probeEndpoint('https://a.com/page')).resolves.toBe(false);
    });
  });

  describe('fetchIntrospection', () => {
    test('should return introspection data on success', async () => {
      const data = { __schema: { types: [] } };
      global.fetch.mockReturnValue(jsonResponse({ data }));
      await expect(fetchIntrospection('https://a.com/graphql')).resolves.toEqual(data);
    });

    test('should report disabled introspection clearly', async () => {
      global.fetch.mockReturnValue(
        jsonResponse({ errors: [{ message: 'GraphQL introspection is not allowed' }] })
      );
      await expect(fetchIntrospection('https://a.com/graphql')).rejects.toThrow(
        'Introspection is disabled'
      );
    });

    test('should surface other GraphQL errors', async () => {
      global.fetch.mockReturnValue(jsonResponse({ errors: [{ message: 'Unauthorized' }] }));
      await expect(fetchIntrospection('https://a.com/graphql')).rejects.toThrow('Unauthorized');
    });

    test('should fail on network errors', async () => {
      global.fetch.mockRejectedValue(new Error('timeout'));
      await expect(fetchIntrospection('https://a.com/graphql')).rejects.toThrow('Failed to reach');
    });

    test('should fail on invalid result shape', async () => {
      global.fetch.mockReturnValue(jsonResponse({ data: {} }));
      await expect(fetchIntrospection('https://a.com/graphql')).rejects.toThrow(
        'valid introspection result'
      );
    });
  });

  describe('loadSchema', () => {
    test('should skip detection when an explicit URL is given', async () => {
      const data = { __schema: { types: [] } };
      global.fetch.mockReturnValue(jsonResponse({ data }));

      const result = await loadSchema({
        tabId: 1,
        tabUrl: 'https://app.test.com/',
        url: 'https://custom.com/graphql',
      });

      expect(result.endpoint).toBe('https://custom.com/graphql');
      expect(result.introspection).toEqual(data);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('should introspect observed endpoints directly with their captured headers', async () => {
      recordEndpoint(1, 'https://api.test.com/gql-observed', [
        { name: 'client-info', value: 'web' },
      ]);
      const data = { __schema: { types: [] } };
      global.fetch.mockReturnValue(jsonResponse({ data }));

      const progress = [];
      const result = await loadSchema({
        tabId: 1,
        tabUrl: 'https://app.test.com/',
        onProgress: (m) => progress.push(m),
      });

      expect(result.endpoint).toBe('https://api.test.com/gql-observed');
      expect(result.introspection).toEqual(data);
      // Observed endpoints are known GraphQL endpoints — no probing round trip
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/gql-observed',
        expect.objectContaining({
          headers: expect.objectContaining({ 'client-info': 'web' }),
        })
      );
      expect(progress.some((m) => m.includes('captured endpoint'))).toBe(true);
    });

    test('should fall back to probing origin guesses when captured endpoints fail', async () => {
      recordEndpoint(1, 'https://api.test.com/gql-observed');
      const data = { __schema: { types: [] } };

      global.fetch.mockImplementation((url, options) => {
        if (url === 'https://api.test.com/gql-observed') {
          return Promise.reject(new Error('403 Forbidden'));
        }
        const body = JSON.parse(options.body);
        if (body.query === '{__typename}') {
          return url === 'https://app.test.com/graphql'
            ? jsonResponse({ data: { __typename: 'Query' } })
            : jsonResponse({ message: 'not found' });
        }
        return jsonResponse({ data });
      });

      const result = await loadSchema({ tabId: 1, tabUrl: 'https://app.test.com/' });

      expect(result.endpoint).toBe('https://app.test.com/graphql');
      expect(result.introspection).toEqual(data);
    });

    test('should report why captured endpoints failed instead of a generic error', async () => {
      recordEndpoint(1, 'https://api.test.com/graphql');

      global.fetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        if (body.query === '{__typename}') {
          return jsonResponse({ message: 'not found' });
        }
        return jsonResponse({ errors: [{ message: 'GraphQL introspection is not allowed' }] });
      });

      await expect(loadSchema({ tabId: 1, tabUrl: 'https://app.test.com/' })).rejects.toThrow(
        /captured endpoint.*Introspection is disabled/
      );
    });

    test('should fail when no endpoint responds', async () => {
      global.fetch.mockRejectedValue(new Error('refused'));

      await expect(loadSchema({ tabId: 99, tabUrl: 'https://app.test.com/' })).rejects.toThrow(
        'No GraphQL endpoint detected'
      );
    });

    test('should fail with guidance when there are no candidates', async () => {
      await expect(loadSchema({ tabId: 99, tabUrl: 'chrome://extensions' })).rejects.toThrow(
        'Enter the GraphQL endpoint URL manually'
      );
    });
  });
});
