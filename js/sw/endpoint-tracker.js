/**
 * Tracks GraphQL endpoint URLs observed by the interceptor, per tab.
 * In-memory only — used to prioritise schema endpoint auto-detection.
 * @module sw/endpoint-tracker
 */

/** Maximum endpoints remembered per tab. */
const MAX_PER_TAB = 10;

/** @type {Map<number, Set<string>>} tabId -> observed endpoint URLs */
const observedEndpoints = new Map();

/**
 * Record a GraphQL endpoint URL observed on a tab.
 * Strips query string/fragment so probes hit the bare endpoint.
 * @param {number} tabId
 * @param {string} url
 */
export function recordEndpoint(tabId, url) {
  if (typeof tabId !== 'number' || !url || typeof url !== 'string') return;

  let normalized;
  try {
    const parsed = new URL(url);
    normalized = parsed.origin + parsed.pathname;
  } catch (_) {
    return;
  }

  let endpoints = observedEndpoints.get(tabId);
  if (!endpoints) {
    endpoints = new Set();
    observedEndpoints.set(tabId, endpoints);
  }

  if (endpoints.size >= MAX_PER_TAB && !endpoints.has(normalized)) return;
  endpoints.add(normalized);
}

/**
 * Get the endpoints observed on a tab, most useful first (insertion order).
 * @param {number} tabId
 * @returns {string[]}
 */
export function getObservedEndpoints(tabId) {
  const endpoints = observedEndpoints.get(tabId);
  return endpoints ? Array.from(endpoints) : [];
}

/**
 * Forget endpoints recorded for a tab (e.g. when the tab closes).
 * @param {number} tabId
 */
export function clearObservedEndpoints(tabId) {
  observedEndpoints.delete(tabId);
}
