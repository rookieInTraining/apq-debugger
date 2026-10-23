/**
 * Intercepted request list: rendering, filtering, selection triggers, and
 * in-place resolution of hash-only rows when their full-query retry lands.
 * @module ui/request-list
 */

import { getElement, escapeHtml } from './dom-helpers.js';
import { state, MAX_HISTORY } from './state.js';
import { selectRequest, renderRequestDetail } from './request-detail.js';
import { updateToolbarState } from './toolbar.js';
import { renderMetrics } from './metrics.js';
import { endpointKey } from './endpoint-utils.js';
import { getRequestState, isAnonymousOperation, shortHash } from './request-state.js';

/**
 * Update the request counter with the current history size.
 */
export function updateRequestCount() {
  const counter = getElement('interception-counter');
  if (counter) counter.textContent = state.requestHistory.length;
}

/**
 * When a full-query request carries a hash, fill in the most recent
 * hash-only row with the same hash: that row's hash is now resolved.
 * @param {object} fullRequest
 * @returns {object|null} The resolved APQ request, if any.
 */
function resolvePendingRow(fullRequest) {
  if (fullRequest.type !== 'full' || !fullRequest.hash || !fullRequest.query) return null;

  const pending = state.requestHistory.find(
    (req) => req.type === 'apq' && !req.query && req.hash === fullRequest.hash
  );
  if (!pending) return null;

  pending.query = fullRequest.query;
  if (!pending.variables) pending.variables = fullRequest.variables;
  if (
    isAnonymousOperation(pending.operationName) &&
    !isAnonymousOperation(fullRequest.operationName)
  ) {
    pending.operationName = fullRequest.operationName;
  }
  pending.resolvedBy = fullRequest.id;
  return pending;
}

/**
 * Re-render one row in place and play the "updated" flash on it.
 * @param {object} request
 */
function refreshRow(request) {
  const existing = document.querySelector(`.request-item[data-request-id="${request.id}"]`);
  if (!existing) return;

  const replacement = createRequestItem(request);
  replacement.setAttribute('tabindex', existing.getAttribute('tabindex') || '-1');
  const hadFocus = document.activeElement === existing;
  existing.replaceWith(replacement);
  if (hadFocus) replacement.focus();

  replacement.classList.add('is-updated');
  replacement.addEventListener('animationend', () => replacement.classList.remove('is-updated'), {
    once: true,
  });
}

/**
 * Add a new request to the history.
 * Uses incremental DOM update (prepend) when possible instead of full re-render.
 * @param {object} requestData
 * @returns {object} The created request record.
 */
export function addRequest(requestData) {
  const request = {
    id: ++state.requestIdCounter,
    timestamp: new Date(),
    operationName: requestData.operationName || 'Unknown',
    url: requestData.url || '',
    type: requestData.isAPQ ? 'apq' : 'full',
    hash: requestData.hash || '',
    query: requestData.query || '',
    variables: requestData.variables || null,
    responseTime: requestData.responseTime || null,
    headers: requestData.headers || [],
    capturedPassive: Boolean(state.passiveMode),
  };

  const resolved = resolvePendingRow(request);

  state.requestHistory.unshift(request);
  if (state.requestHistory.length > MAX_HISTORY) {
    state.requestHistory.length = MAX_HISTORY;
  }
  updateRequestCount();
  updateToolbarState();
  renderMetrics();

  // Incremental update: prepend the new item if it passes the current filter,
  // instead of clearing and re-rendering the entire list. When endpoint
  // grouping is active the item belongs under its group header, so fall
  // back to a full re-render.
  if (isGroupingActive()) {
    renderRequestList();
  } else if (requestPassesFilter(request)) {
    prependRequestItem(request);
  }

  if (resolved) {
    refreshRow(resolved);
    if (state.selectedRequestId === resolved.id) renderRequestDetail(resolved.id);
  }

  return request;
}

/**
 * Endpoint group headers appear when more than one endpoint has traffic
 * and no endpoint filter is active.
 * @returns {boolean}
 */
function isGroupingActive() {
  if (state.endpointFilter) return false;
  const keys = new Set();
  for (const req of state.requestHistory) {
    const key = endpointKey(req.url);
    if (key) keys.add(key);
    if (keys.size > 1) return true;
  }
  return false;
}

/**
 * Check if a request passes the active type and text filters.
 * @param {object} req
 * @returns {boolean}
 */
function requestPassesFilter(req) {
  if (state.activeFilter !== 'all' && req.type !== state.activeFilter) {
    return false;
  }
  if (state.endpointFilter && endpointKey(req.url) !== state.endpointFilter) {
    return false;
  }
  if (state.filterText) {
    const searchText = state.filterText.toLowerCase();
    return (
      req.operationName.toLowerCase().includes(searchText) ||
      req.url.toLowerCase().includes(searchText)
    );
  }
  return true;
}

/**
 * Show the empty state, worded for "nothing captured" or "nothing matches".
 */
function showEmptyState() {
  const emptyState = getElement('empty-state');
  if (!emptyState) return;
  emptyState.style.display = 'flex';

  const filtered = state.requestHistory.length > 0;
  emptyState.classList.toggle('is-filtered', filtered);
  const title = document.getElementById('empty-title');
  if (title) {
    title.textContent = filtered ? 'No operations match the filter' : 'No operations captured yet';
  }
}

/**
 * Prepend a single request item to the top of the list container.
 * Hides the empty state and trims overflow DOM nodes if history is capped.
 * @param {object} request
 */
function prependRequestItem(request) {
  const listContainer = getElement('request-list');
  const emptyState = getElement('empty-state');
  if (!listContainer) return;

  if (emptyState) emptyState.style.display = 'none';

  const item = createRequestItem(request);
  const firstItem = listContainer.querySelector('.request-item');
  if (firstItem) {
    listContainer.insertBefore(item, firstItem);
  } else {
    listContainer.appendChild(item);
  }

  // Trim excess DOM nodes when history cap causes oldest entries to be dropped
  const items = listContainer.querySelectorAll('.request-item');
  if (items.length > MAX_HISTORY) {
    for (let i = MAX_HISTORY; i < items.length; i++) {
      items[i].remove();
    }
  }
}

/**
 * Return the request history filtered by the active type chip and text filter.
 * @returns {object[]}
 */
export function getFilteredRequests() {
  return state.requestHistory.filter(requestPassesFilter);
}

/**
 * Re-render the full request list (clears existing items first).
 */
export function renderRequestList() {
  const listContainer = getElement('request-list');
  const emptyState = getElement('empty-state');
  if (!listContainer) return;

  renderMetrics();

  const filtered = getFilteredRequests();

  // Clear existing request items and group headers (preserve empty-state)
  listContainer
    .querySelectorAll('.request-item, .request-group-header')
    .forEach((el) => el.remove());

  if (filtered.length === 0) {
    showEmptyState();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  if (isGroupingActive()) {
    // Partition by endpoint (first-seen order); recency order within groups
    const groups = new Map();
    for (const request of filtered) {
      const key = endpointKey(request.url) || request.url;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(request);
    }
    for (const [key, requests] of groups) {
      const header = document.createElement('div');
      header.className = 'request-group-header';
      header.setAttribute('role', 'presentation');
      header.title = key;

      const label = document.createElement('span');
      label.className = 'group-label';
      label.textContent = key.replace(/^https?:\/\//, '');
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = requests.length === 1 ? '1 request' : `${requests.length} requests`;
      header.append(label, count);

      listContainer.appendChild(header);
      requests.forEach((request) => {
        listContainer.appendChild(createRequestItem(request));
      });
    }
    return;
  }

  filtered.forEach((request) => {
    const item = createRequestItem(request);
    listContainer.appendChild(item);
  });
}

/**
 * Create a single request list row.
 * @param {object} request
 * @returns {HTMLElement}
 */
function createRequestItem(request) {
  const item = document.createElement('div');
  item.className = 'request-item';
  item.setAttribute('role', 'option');
  item.setAttribute('tabindex', '-1');
  const isSelected = request.id === state.selectedRequestId;
  if (isSelected) {
    item.classList.add('selected');
  }
  item.setAttribute('aria-selected', String(isSelected));
  item.dataset.requestId = request.id;
  if (request.url) item.title = request.url;

  const timeStr = request.timestamp.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const rowState = getRequestState(request);
  const anonymous = isAnonymousOperation(request.operationName);
  const name = anonymous ? '(anonymous)' : request.operationName;

  item.innerHTML = `
    <span class="col-name request-operation${anonymous ? ' is-anonymous' : ''}">${escapeHtml(name)}</span>
    <span class="col-state"><span class="state state--${rowState.key}">${rowState.label}</span></span>
    <span class="col-hash request-hash">${escapeHtml(shortHash(request.hash))}</span>
    <span class="col-time request-time">${timeStr}</span>
  `;

  item.addEventListener('click', () => selectRequest(request.id));

  return item;
}

/**
 * Wire up filter input and filter chip event listeners.
 */
export function initRequestList() {
  const filterInput = getElement('filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      state.filterText = e.target.value;
      renderRequestList();
    });
  }

  document.querySelectorAll('.filter-chips .chip, .chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filter]').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-checked', String(active));
        c.setAttribute('tabindex', active ? '0' : '-1');
      });
      state.activeFilter = chip.dataset.filter;
      renderRequestList();
    });
  });
}
