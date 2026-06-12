/**
 * Intercepted request list: rendering, filtering, and selection triggers.
 * @module ui/request-list
 */

import { getElement, escapeHtml, truncateUrl } from './dom-helpers.js';
import { state, MAX_HISTORY } from './state.js';
import { selectRequest } from './request-detail.js';
import { updateToolbarState } from './toolbar.js';

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animate the request counter badge with the current history size.
 */
export function updateRequestCount() {
  const counter = getElement('interception-counter');
  if (counter) {
    counter.textContent = state.requestHistory.length;
    if (!prefersReducedMotion()) {
      counter.style.transform = 'scale(1.2)';
      setTimeout(() => {
        counter.style.transform = 'scale(1)';
      }, 200);
    }
  }
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
  };

  state.requestHistory.unshift(request);
  if (state.requestHistory.length > MAX_HISTORY) {
    state.requestHistory.length = MAX_HISTORY;
  }
  updateRequestCount();
  updateToolbarState();

  // Incremental update: prepend the new item if it passes the current filter,
  // instead of clearing and re-rendering the entire list.
  if (requestPassesFilter(request)) {
    prependRequestItem(request);
  }

  return request;
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
  return state.requestHistory.filter((req) => {
    if (state.activeFilter !== 'all' && req.type !== state.activeFilter) {
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
  });
}

/**
 * Re-render the full request list (clears existing items first).
 */
export function renderRequestList() {
  const listContainer = getElement('request-list');
  const emptyState = getElement('empty-state');
  if (!listContainer) return;

  const filtered = getFilteredRequests();

  // Clear existing request items (preserve the empty-state element)
  listContainer.querySelectorAll('.request-item').forEach((el) => el.remove());

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  filtered.forEach((request) => {
    const item = createRequestItem(request);
    listContainer.appendChild(item);
  });
}

/**
 * Create a single request list item DOM element.
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

  const timeStr = request.timestamp.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  item.innerHTML = `
    <div class="request-info">
        <div class="request-operation">${escapeHtml(request.operationName)}</div>
        <div class="request-url">${escapeHtml(truncateUrl(request.url))}</div>
    </div>
    <div class="request-meta">
        <span class="request-time">${timeStr}</span>
        <span class="request-badge ${request.type}">${request.type.toUpperCase()}</span>
    </div>
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

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => {
        c.classList.remove('active');
        c.setAttribute('aria-checked', 'false');
      });
      chip.classList.add('active');
      chip.setAttribute('aria-checked', 'true');
      state.activeFilter = chip.dataset.filter;
      renderRequestList();
    });
  });
}
