/**
 * GraphQL schema loading with endpoint auto-detection.
 * Probes candidate endpoints (observed traffic first, then common paths
 * on the inspected tab's origin) and fetches the introspection result.
 * Runs in the service worker, which has <all_urls> host permissions,
 * so cross-origin fetches are allowed.
 * @module sw/schema-loader
 */

import { getObservedEndpoints } from './endpoint-tracker.js';
import {
  COMMON_GRAPHQL_PATHS,
  INTROSPECTION_QUERY,
  SCHEMA_PROBE_TIMEOUT_MS,
  SCHEMA_MAX_CANDIDATES,
} from '../shared/constants.js';

/**
 * Build the prioritised candidate endpoint list for a tab.
 * @param {number} tabId
 * @param {string} tabUrl - URL of the inspected page.
 * @returns {string[]}
 */
export function buildCandidates(tabId, tabUrl) {
  const candidates = [];
  const seen = new Set();

  const push = (url) => {
    if (url && !seen.has(url) && candidates.length < SCHEMA_MAX_CANDIDATES) {
      seen.add(url);
      candidates.push(url);
    }
  };

  // 1. Endpoints actually observed by the interceptor on this tab
  for (const url of getObservedEndpoints(tabId)) {
    push(url);
  }

  // 2. Common GraphQL paths on the inspected page's origin
  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      for (const path of COMMON_GRAPHQL_PATHS) {
        push(parsed.origin + path);
      }
    }
  } catch (_) {
    // Invalid tab URL (about:blank, empty, ...) — skip origin candidates
  }

  return candidates;
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a URL to see whether it responds like a GraphQL endpoint.
 * Qualifies on `data.__typename` or a GraphQL-shaped `errors` array
 * (an endpoint that rejects the query but speaks GraphQL still counts).
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function probeEndpoint(url) {
  try {
    const json = await postJson(url, { query: '{__typename}' }, SCHEMA_PROBE_TIMEOUT_MS);
    if (!json || typeof json !== 'object') return false;

    if (json.data && typeof json.data.__typename === 'string') return true;
    if (Array.isArray(json.errors) && json.errors.length > 0 && json.errors[0].message) {
      return true;
    }
    return false;
  } catch (_) {
    // Network error, timeout, non-JSON response — not a GraphQL endpoint
    return false;
  }
}

/**
 * Fetch the introspection result from a GraphQL endpoint.
 * @param {string} url
 * @returns {Promise<object>} The introspection data (`{ __schema: ... }`).
 * @throws {Error} If the request fails or introspection is disabled.
 */
export async function fetchIntrospection(url) {
  let json;
  try {
    json = await postJson(url, { query: INTROSPECTION_QUERY }, SCHEMA_PROBE_TIMEOUT_MS * 3);
  } catch (error) {
    throw new Error(`Failed to reach ${url}: ${error.message || 'network error'}`);
  }

  if (json && json.data && json.data.__schema) {
    return json.data;
  }

  if (json && Array.isArray(json.errors) && json.errors.length > 0) {
    const message = json.errors[0].message || '';
    if (/introspection/i.test(message)) {
      throw new Error('Introspection is disabled on this endpoint');
    }
    throw new Error(`Introspection failed: ${message || 'unknown GraphQL error'}`);
  }

  throw new Error('Endpoint did not return a valid introspection result');
}

/**
 * Detect a GraphQL endpoint for a tab and load its schema.
 * Probes all candidates in parallel and picks the highest-priority hit.
 * @param {object} options
 * @param {number} options.tabId
 * @param {string} options.tabUrl - URL of the inspected page.
 * @param {string} [options.url] - Explicit endpoint (skips detection).
 * @param {(message: string) => void} [options.onProgress]
 * @returns {Promise<{endpoint: string, introspection: object}>}
 * @throws {Error} If no endpoint is found or introspection fails.
 */
export async function loadSchema({ tabId, tabUrl, url, onProgress = () => {} }) {
  if (url) {
    onProgress(`Loading schema from ${url}...`);
    const introspection = await fetchIntrospection(url);
    return { endpoint: url, introspection };
  }

  const candidates = buildCandidates(tabId, tabUrl);
  if (candidates.length === 0) {
    throw new Error('No candidate endpoints. Enter the GraphQL endpoint URL manually.');
  }

  onProgress(
    `Probing ${candidates.length} candidate endpoint${candidates.length > 1 ? 's' : ''}...`
  );

  const results = await Promise.all(candidates.map((candidate) => probeEndpoint(candidate)));
  const endpoint = candidates.find((_, i) => results[i]);

  if (!endpoint) {
    throw new Error(
      'No GraphQL endpoint detected. Capture some traffic first or enter the URL manually.'
    );
  }

  onProgress(`Endpoint found: ${endpoint}. Loading schema...`);
  const introspection = await fetchIntrospection(endpoint);
  return { endpoint, introspection };
}
