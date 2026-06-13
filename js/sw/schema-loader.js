/**
 * GraphQL schema loading with endpoint auto-detection.
 * Endpoints observed by the interceptor are known to speak GraphQL, so they
 * are introspected directly with their captured request headers (production
 * gateways often reject bare requests). Only origin-based guesses at common
 * GraphQL paths are probed first.
 * Runs in the service worker, which has <all_urls> host permissions,
 * so cross-origin fetches are allowed.
 * @module sw/schema-loader
 */

import { ensureEndpointsLoaded, getObservedEndpointEntries } from './endpoint-tracker.js';
import {
  COMMON_GRAPHQL_PATHS,
  INTROSPECTION_QUERY,
  SCHEMA_PROBE_TIMEOUT_MS,
  SCHEMA_MAX_CANDIDATES,
} from '../shared/constants.js';

/**
 * Build candidate endpoints from common GraphQL paths on the page's origin.
 * @param {string} tabUrl - URL of the inspected page.
 * @param {string[]} [excludeUrls] - URLs already tried (observed endpoints).
 * @returns {string[]}
 */
export function buildOriginCandidates(tabUrl, excludeUrls = []) {
  const candidates = [];
  const seen = new Set(excludeUrls);

  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      for (const path of COMMON_GRAPHQL_PATHS) {
        const url = parsed.origin + path;
        if (!seen.has(url) && candidates.length < SCHEMA_MAX_CANDIDATES) {
          seen.add(url);
          candidates.push(url);
        }
      }
    }
  } catch (_) {
    // Invalid tab URL (about:blank, empty, ...) — skip origin candidates
  }

  return candidates;
}

async function postJson(url, body, timeoutMs, headers = []) {
  const requestHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };
  for (const header of headers) {
    // Cookies ride along via credentials: 'include'; fetch forbids setting them
    if (header && header.name && header.name.toLowerCase() !== 'cookie') {
      requestHeaders[header.name] = header.value;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders,
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
 * @param {{name: string, value: string}[]} [headers] - Captured request headers
 *   replayed so gateways that require client headers accept the request.
 * @returns {Promise<object>} The introspection data (`{ __schema: ... }`).
 * @throws {Error} If the request fails or introspection is disabled.
 */
export async function fetchIntrospection(url, headers = []) {
  let json;
  try {
    json = await postJson(
      url,
      { query: INTROSPECTION_QUERY },
      SCHEMA_PROBE_TIMEOUT_MS * 3,
      headers
    );
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
 * Observed endpoints are introspected directly (they are known GraphQL
 * endpoints); origin-based guesses are probed in parallel as a fallback.
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

  // Observations usually live only in storage at this point: the loadSchema
  // message tends to wake a fresh service worker with an empty in-memory map.
  await ensureEndpointsLoaded();

  const observed = getObservedEndpointEntries(tabId);
  const observedErrors = [];

  for (const { url: endpoint, headers } of observed) {
    onProgress(`Loading schema from captured endpoint ${endpoint}...`);
    try {
      const introspection = await fetchIntrospection(endpoint, headers);
      return { endpoint, introspection };
    } catch (error) {
      observedErrors.push(`${endpoint} — ${error.message}`);
    }
  }

  const candidates = buildOriginCandidates(
    tabUrl,
    observed.map((entry) => entry.url)
  );

  if (candidates.length === 0 && observedErrors.length === 0) {
    throw new Error('No candidate endpoints. Enter the GraphQL endpoint URL manually.');
  }

  let endpoint = null;
  if (candidates.length > 0) {
    onProgress(
      `Probing ${candidates.length} candidate endpoint${candidates.length > 1 ? 's' : ''}...`
    );
    const results = await Promise.all(candidates.map((candidate) => probeEndpoint(candidate)));
    endpoint = candidates.find((_, i) => results[i]);
  }

  if (!endpoint) {
    if (observedErrors.length > 0) {
      // The captured endpoints are the real ones — report why they failed
      // instead of pretending no endpoint exists.
      throw new Error(
        `Could not introspect the captured endpoint${observedErrors.length > 1 ? 's' : ''}: ` +
          observedErrors.join('; ')
      );
    }
    throw new Error(
      'No GraphQL endpoint detected. Capture some traffic first or enter the URL manually.'
    );
  }

  onProgress(`Endpoint found: ${endpoint}. Loading schema...`);
  const introspection = await fetchIntrospection(endpoint);
  return { endpoint, introspection };
}
