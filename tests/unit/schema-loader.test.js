import {
  buildCandidates,
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

  describe('buildCandidates', () => {
    test('should put observed endpoints before origin-based guesses', () => {
      recordEndpoint(1, 'https://api.other.com/v2/gql');
      const candidates = buildCandidates(1, 'https://app.test.com/dashboard');

      expect(candidates[0]).toBe('https://api.other.com/v2/gql');
      expect(candidates).toContain('https://app.test.com/graphql');
      expect(candidates).toContain('https://app.test.com/api/graphql');
    });

    test('should skip origin guesses for invalid tab URLs', () => {
      const candidates = buildCandidates(1, 'chrome://extensions');
      expect(candidates).toEqual([]);
    });

    test('should deduplicate observed and guessed endpoints', () => {
      recordEndpoint(1, 'https://app.test.com/graphql');
      const candidates = buildCandidates(1, 'https://app.test.com/');
      expect(candidates.filter((c) => c === 'https://app.test.com/graphql')).toHaveLength(1);
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

    test('should pick the highest-priority working endpoint', async () => {
      recordEndpoint(1, 'https://api.test.com/gql-observed');
      const data = { __schema: { types: [] } };

      global.fetch.mockImplementation((url, options) => {
        const body = JSON.parse(options.body);
        if (body.query === '{__typename}') {
          if (url === 'https://api.test.com/gql-observed' || url.endsWith('/graphql')) {
            return jsonResponse({ data: { __typename: 'Query' } });
          }
          return jsonResponse({ message: 'not found' });
        }
        return jsonResponse({ data });
      });

      const progress = [];
      const result = await loadSchema({
        tabId: 1,
        tabUrl: 'https://app.test.com/',
        onProgress: (m) => progress.push(m),
      });

      expect(result.endpoint).toBe('https://api.test.com/gql-observed');
      expect(result.introspection).toEqual(data);
      expect(progress.some((m) => m.includes('Probing'))).toBe(true);
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
