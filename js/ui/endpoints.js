/**
 * Observed GraphQL endpoints: the patterns-pane row (with per-endpoint request
 * counts and one-click "Add as pattern") and the endpoint filter in the
 * requests view. Endpoint URLs come from the service worker's
 * endpoint-tracker, merged with origins seen in the captured history.
 * @module ui/endpoints
 */

import { getElement } from './dom-helpers.js';
import { state, inspectedTabId } from './state.js';
import { endpointKey } from './endpoint-utils.js';
import { addPatternField } from './patterns.js';
import { renderRequestList } from './request-list.js';

/** Endpoint URLs reported by the service worker (already normalized). */
let observedFromWorker = [];

let refreshTimer = null;

/** Debounce so a burst of intercepts causes one worker round-trip. */
const REFRESH_DEBOUNCE_MS = 2000;

/**
 * All known endpoints: worker observations first, then history-only ones.
 * @returns {string[]}
 */
function getKnownEndpoints() {
  const known = new Set(observedFromWorker);
  for (const request of state.requestHistory) {
    const key = endpointKey(request.url);
    if (key) known.add(key);
  }
  return Array.from(known);
}

/** Per-endpoint captured-request counts from history. */
function getEndpointCounts() {
  const counts = new Map();
  for (const request of state.requestHistory) {
    const key = endpointKey(request.url);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Suggested URL pattern for an endpoint (host + path, wildcarded).
 * @param {string} endpoint
 * @returns {string}
 */
function patternForEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    return `*${parsed.host}${parsed.pathname}*`;
  } catch (_) {
    return `*${endpoint}*`;
  }
}

function buildEndpointRow(endpoint, count) {
  const row = document.createElement('div');
  row.className = 'endpoint-item';
  row.setAttribute('role', 'listitem');

  const info = document.createElement('div');
  info.className = 'endpoint-info';

  const urlEl = document.createElement('span');
  urlEl.className = 'endpoint-url';
  urlEl.textContent = endpoint.replace(/^https?:\/\//, '');
  urlEl.title = endpoint;
  info.appendChild(urlEl);

  const countEl = document.createElement('span');
  countEl.className = 'endpoint-count';
  countEl.textContent = String(count);
  countEl.title = count === 1 ? '1 request captured' : `${count} requests captured`;
  info.appendChild(countEl);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'link-btn';
  addBtn.textContent = 'Add as pattern';
  addBtn.setAttribute('aria-label', `Add ${endpoint} as URL pattern`);
  addBtn.addEventListener('click', () => {
    addPatternField(patternForEndpoint(endpoint));
  });

  row.appendChild(info);
  row.appendChild(addBtn);
  return row;
}

/**
 * Rebuild the endpoint filter select. Visible only when more than one
 * endpoint has been seen; a vanished selection resets to all endpoints.
 * @param {string[]} endpoints
 */
function renderEndpointFilter(endpoints) {
  const select = getElement('endpoint-filter');
  if (!select) return;

  const previous = state.endpointFilter;
  select.textContent = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All endpoints';
  select.appendChild(allOption);

  for (const endpoint of endpoints) {
    const option = document.createElement('option');
    option.value = endpoint;
    option.textContent = endpoint.replace(/^https?:\/\//, '');
    select.appendChild(option);
  }

  if (previous && endpoints.includes(previous)) {
    select.value = previous;
  } else {
    select.value = '';
    if (previous) {
      state.endpointFilter = '';
      renderRequestList();
    }
  }

  select.classList.toggle('hidden', endpoints.length < 2);
}

/**
 * Re-render the drawer section and the endpoint filter from current data.
 */
export function renderEndpointsView() {
  const section = getElement('endpoints-section');
  const listEl = getElement('observed-endpoints');
  const endpoints = getKnownEndpoints();

  if (section && listEl) {
    section.classList.toggle('hidden', endpoints.length === 0);
    const counts = getEndpointCounts();
    listEl.textContent = '';
    for (const endpoint of endpoints) {
      listEl.appendChild(buildEndpointRow(endpoint, counts.get(endpoint) || 0));
    }
  }

  renderEndpointFilter(endpoints);
}

/** Fetch worker-observed endpoints, then re-render. */
function fetchObservedEndpoints() {
  chrome.runtime.sendMessage({ getObservedEndpoints: true, tabId: inspectedTabId }, (response) => {
    if (chrome.runtime.lastError) {
      // Worker may be restarting; history-derived endpoints still render
      renderEndpointsView();
      return;
    }
    if (response && response.status === 'SUCCESS' && Array.isArray(response.endpoints)) {
      observedFromWorker = response.endpoints;
    }
    renderEndpointsView();
  });
}

/**
 * Schedule a debounced worker refresh (called on every INTERCEPTED message).
 */
export function scheduleEndpointsRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    fetchObservedEndpoints();
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * Wire the endpoint filter and load the initial endpoint list.
 */
export function initEndpoints() {
  const select = getElement('endpoint-filter');
  if (select) {
    select.addEventListener('change', () => {
      state.endpointFilter = select.value;
      renderRequestList();
    });
  }
  fetchObservedEndpoints();
}
