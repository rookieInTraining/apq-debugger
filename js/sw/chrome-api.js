/**
 * Promise wrappers for Chrome extension APIs.
 * Eliminates callback nesting and enables async/await usage.
 * @module sw/chrome-api
 */

/**
 * Retrieve all debugger targets (tabs, workers, etc.) from the Chrome Debugger API.
 * @returns {Promise<chrome.debugger.TargetInfo[]>} Array of debugger target descriptors.
 */
export function getTargets() {
  return new Promise((resolve, reject) => {
    chrome.debugger.getTargets((targets) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(targets);
    });
  });
}

/**
 * Attach the Chrome Debugger to a tab.
 * @param {number} tabId - The ID of the tab to attach to.
 * @param {string} [version='1.3'] - Chrome DevTools Protocol version.
 * @returns {Promise<void>} Resolves when the debugger is attached.
 */
export function attachDebugger(tabId, version = '1.3') {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, version, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/**
 * Detach the Chrome Debugger from a tab.
 * @param {number} tabId - The ID of the tab to detach from.
 * @returns {Promise<void>} Resolves when the debugger is detached.
 */
export function detachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/**
 * Send a Chrome DevTools Protocol command to a debugger-attached tab.
 * @param {number} tabId - The ID of the target tab.
 * @param {string} method - The CDP method name (e.g., "Fetch.enable").
 * @param {object} [params={}] - Parameters for the CDP command.
 * @returns {Promise<*>} The command result.
 */
export function sendDebuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

/**
 * Query open tabs matching the given criteria.
 * @param {chrome.tabs.QueryInfo} queryInfo - Tab query parameters.
 * @returns {Promise<chrome.tabs.Tab[]>} Array of matching tabs.
 */
export function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(tabs);
    });
  });
}

/**
 * Get details about a specific tab by its ID.
 * @param {number} tabId - The ID of the tab to retrieve.
 * @returns {Promise<chrome.tabs.Tab>} The tab object.
 */
export function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(tab);
    });
  });
}

/**
 * Read values from `chrome.storage.local`.
 * @param {string|string[]} keys - Storage key(s) to retrieve.
 * @returns {Promise<object>} Object containing the requested key/value pairs.
 */
export function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

/**
 * Write values to `chrome.storage.local`.
 * @param {object} items - Key/value pairs to store.
 * @returns {Promise<void>} Resolves when the data is persisted.
 */
export function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
