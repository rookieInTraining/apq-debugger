/**
 * Tracks GraphQL endpoint URLs observed by the interceptor, per tab, along
 * with the request headers captured from the live traffic (production
 * gateways often reject requests without their expected client headers).
 * Used to prioritise schema endpoint auto-detection. Observations are
 * persisted so they survive MV3 service worker restarts — without this,
 * the tracker would usually be empty by the time the user clicks
 * "Load Schema", because the message itself wakes a fresh service worker.
 * @module sw/endpoint-tracker
 */

import { OBSERVED_ENDPOINTS_STORAGE_KEY } from '../shared/constants.js';
import { log } from '../shared/logger.js';

/** Maximum endpoints remembered per tab. */
const MAX_PER_TAB = 10;

/** @type {Map<number, Map<string, {headers: {name: string, value: string}[]}>>} */
const observedEndpoints = new Map();

/** @type {Promise<void>|null} */
let loadPromise = null;

// storage.session survives service worker restarts and is cleared when the
// browser closes (the right lifetime for per-tab observations); storage.local
// is the fallback for Chrome < 102.
function storageArea() {
  return chrome.storage.session || chrome.storage.local;
}

/**
 * Load persisted observations into memory (first call only).
 * Endpoints recorded before the load resolves are kept; stored entries are
 * merged in behind them, so a fresh service worker never loses live traffic.
 * @returns {Promise<void>}
 */
export function ensureEndpointsLoaded() {
  if (!loadPromise) {
    loadPromise = new Promise((resolve) => {
      try {
        storageArea().get([OBSERVED_ENDPOINTS_STORAGE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            log.error('Failed to load observed endpoints:', chrome.runtime.lastError);
          } else {
            mergeStored(result[OBSERVED_ENDPOINTS_STORAGE_KEY]);
          }
          resolve();
        });
      } catch (error) {
        log.error('Failed to load observed endpoints:', error);
        resolve();
      }
    });
  }
  return loadPromise;
}

function mergeStored(stored) {
  if (!stored || typeof stored !== 'object') return;

  for (const [key, entries] of Object.entries(stored)) {
    const tabId = Number(key);
    if (!Number.isInteger(tabId) || !Array.isArray(entries)) continue;

    let endpoints = observedEndpoints.get(tabId);
    if (!endpoints) {
      endpoints = new Map();
      observedEndpoints.set(tabId, endpoints);
    }
    for (const entry of entries) {
      if (endpoints.size >= MAX_PER_TAB) break;
      // Entries persisted before headers were tracked are plain URL strings
      const url = typeof entry === 'string' ? entry : entry && entry.url;
      if (!url || typeof url !== 'string' || endpoints.has(url)) continue;
      const headers = Array.isArray(entry && entry.headers) ? entry.headers : [];
      endpoints.set(url, { headers });
    }
  }
}

function persistEndpoints() {
  const obj = {};
  for (const [tabId, endpoints] of observedEndpoints) {
    obj[tabId] = Array.from(endpoints, ([url, data]) => ({ url, headers: data.headers }));
  }
  try {
    storageArea().set({ [OBSERVED_ENDPOINTS_STORAGE_KEY]: obj }, () => {
      if (chrome.runtime.lastError) {
        log.error('Failed to persist observed endpoints:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    log.error('Failed to persist observed endpoints:', error);
  }
}

/**
 * Record a GraphQL endpoint URL observed on a tab.
 * Strips query string/fragment so probes hit the bare endpoint.
 * The first captured header set is kept; later captures only fill in
 * headers for endpoints that were recorded without any.
 * @param {number} tabId
 * @param {string} url
 * @param {{name: string, value: string}[]} [headers] - Captured request headers.
 */
export function recordEndpoint(tabId, url, headers = []) {
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
    endpoints = new Map();
    observedEndpoints.set(tabId, endpoints);
  }

  const headerList = Array.isArray(headers) ? headers : [];
  const existing = endpoints.get(normalized);
  if (existing) {
    // Persist again only when this capture adds headers we didn't have
    if (existing.headers.length > 0 || headerList.length === 0) return;
    existing.headers = headerList;
  } else {
    if (endpoints.size >= MAX_PER_TAB) return;
    endpoints.set(normalized, { headers: headerList });
  }

  // Persist only after the stored snapshot has been merged in, so a write
  // from a fresh service worker can't clobber earlier observations.
  ensureEndpointsLoaded().then(persistEndpoints);
}

/**
 * Get the endpoint URLs observed on a tab, most useful first (insertion order).
 * @param {number} tabId
 * @returns {string[]}
 */
export function getObservedEndpoints(tabId) {
  const endpoints = observedEndpoints.get(tabId);
  return endpoints ? Array.from(endpoints.keys()) : [];
}

/**
 * Get the endpoints observed on a tab with their captured headers.
 * Callers that must see observations from before a service worker restart
 * should await {@link ensureEndpointsLoaded} first.
 * @param {number} tabId
 * @returns {{url: string, headers: {name: string, value: string}[]}[]}
 */
export function getObservedEndpointEntries(tabId) {
  const endpoints = observedEndpoints.get(tabId);
  if (!endpoints) return [];
  return Array.from(endpoints, ([url, data]) => ({ url, headers: data.headers }));
}

/**
 * Forget endpoints recorded for a tab (e.g. when the tab closes).
 * @param {number} tabId
 */
export function clearObservedEndpoints(tabId) {
  observedEndpoints.delete(tabId);
  ensureEndpointsLoaded().then(() => {
    // The merge may have brought the tab's stored entries back — drop them too
    observedEndpoints.delete(tabId);
    persistEndpoints();
  });
}
