/**
 * Shared constants used across service-worker and UI bundles.
 * @module shared/constants
 */

// ── Interceptor ───────────────────────────────────────────────────

export const BOGUS_HASH_SEED = '1234567890';
export const BASE64_CHUNK_SIZE = 8192;
export const DEFAULT_OPERATION_NAME = 'Anonymous Query';

// ── Hash Registry / Passive Mode ──────────────────────────────────

export const HASH_REGISTRY_STORAGE_KEY = 'apqHashRegistry';
export const PASSIVE_MODE_STORAGE_KEY = 'apqPassiveMode';
/** Maximum hashes retained in the registry; least recently registered evicted first. */
export const HASH_REGISTRY_MAX_ENTRIES = 500;

// ── Schema ────────────────────────────────────────────────────────

export const OBSERVED_ENDPOINTS_STORAGE_KEY = 'apqObservedEndpoints';
export const SCHEMA_STORAGE_KEY = 'apqSchemaUrl';
export const SCHEMA_CACHE_STORAGE_KEY = 'apqSchemaCache';
/** Maximum SDL size (bytes) persisted to chrome.storage.local. */
export const SCHEMA_CACHE_MAX_BYTES = 2 * 1024 * 1024;
/** Common GraphQL endpoint paths probed during auto-detection. */
export const COMMON_GRAPHQL_PATHS = [
  '/graphql',
  '/api/graphql',
  '/gql',
  '/api/gql',
  '/query',
  '/v1/graphql',
  '/graphql/v1',
];

/** Timeout for a single endpoint probe request (ms). */
export const SCHEMA_PROBE_TIMEOUT_MS = 4000;
/** Maximum number of candidate endpoints probed per detection run. */
export const SCHEMA_MAX_CANDIDATES = 10;
/**
 * Standard GraphQL introspection query (classic graphql-js form, compatible
 * with `buildClientSchema`). Kept as a string literal so the service worker
 * bundle does not need to include the `graphql` package.
 */
export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types { ...FullType }
      directives {
        name
        description
        locations
        args { ...InputValue }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args { ...InputValue }
      type { ...TypeRef }
      isDeprecated
      deprecationReason
    }
    inputFields { ...InputValue }
    interfaces { ...TypeRef }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes { ...TypeRef }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ── UI Settings ───────────────────────────────────────────────────
export const UI_SETTINGS_STORAGE_KEY = 'apqUiSettings';
export const PANEL_WIDTHS_STORAGE_KEY = 'apqPanelWidths';
