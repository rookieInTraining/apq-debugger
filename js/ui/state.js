/**
 * Shared state management for the DevTools panel.
 * @module ui/state
 */

/** Storage key used to persist URL patterns in `chrome.storage.local`. */
export const PATTERNS_STORAGE_KEY = 'apqPatterns';

/** Maximum number of requests to retain in history before dropping oldest entries. */
export const MAX_HISTORY = 500;

/** Tab ID of the page being inspected (stable even when DevTools is undocked). */
export const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

/**
 * Mutable application state shared across all UI modules.
 * @type {{
 *   totalPatterns: number,
 *   isDebuggerActive: boolean,
 *   currentOperation: string|null,
 *   selectedRequestId: number|null,
 *   activeFilter: string,
 *   filterText: string,
 *   requestHistory: object[],
 *   requestIdCounter: number,
 *   statusBannerTimeout: number|null
 * }}
 */
export const state = {
  totalPatterns: 1,
  isDebuggerActive: false,
  currentOperation: null,
  selectedRequestId: null,
  activeFilter: 'all',
  filterText: '',
  requestHistory: [],
  requestIdCounter: 0,
  statusBannerTimeout: null,
};
