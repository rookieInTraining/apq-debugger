/**
 * Message routing and toolbar action handling.
 * @module sw/messaging
 */

import { queryTabs, getTab } from './chrome-api.js';
import { getStoredPatterns } from './storage.js';
import {
  attachedTabs,
  validateUrlPattern,
  isDebuggerActive,
  attachDebuggerToTab,
  detachDebuggerFromTab,
} from './debugger-manager.js';

/**
 * Broadcast a status update to all listeners (DevTools panel, popup, etc.).
 * Silently ignores errors when no listener is available.
 * @param {object} payload - The status payload (e.g., `{ active: true, message: '...' }`).
 * @param {number|null} tabId - The tab ID the update pertains to.
 */
export function sendActionUpdate(payload, tabId) {
  chrome.runtime.sendMessage({ status: 'ACTION_TOGGLE', ...payload, tabId }, () => {
    if (chrome.runtime.lastError) {
      // Common for this to fail if no DevTools or popup is listening
    }
  });
}

/**
 * Toggle the debugger on/off from the browser action button or context menu.
 * Reads stored patterns, attaches or detaches the debugger for the active tab,
 * and broadcasts the result to all listeners.
 * @returns {Promise<void>}
 */
export async function toggleDebuggerFromAction() {
  let currentTab;
  try {
    currentTab = await getActiveTab();
  } catch (error) {
    sendActionUpdate({ active: false, error: error.message }, null);
    return;
  }

  // If already attached, detach
  if (attachedTabs.has(currentTab.id)) {
    const result = await detachDebuggerFromTab(currentTab.id);
    if (result.status === 'SUCCESS') {
      sendActionUpdate({ active: false }, currentTab.id);
    } else {
      sendActionUpdate(
        { active: false, error: result.error || 'Failed to detach debugger' },
        currentTab.id
      );
    }
    return;
  }

  // Otherwise, try to attach
  const storedPatterns = await getStoredPatterns();

  if (!storedPatterns || storedPatterns.length === 0) {
    const errorMsg =
      'No URL patterns configured. Please open DevTools > APQ Debugger to add patterns.';

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'APQ Debugger',
      message: errorMsg,
    });

    chrome.action.setBadgeText({ text: 'ERR', tabId: currentTab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#f0ad4e', tabId: currentTab.id });

    sendActionUpdate({ active: false, error: errorMsg }, currentTab.id);
    return;
  }

  let validPatterns;
  try {
    validPatterns = storedPatterns.map((pattern) => ({
      urlPattern: validateUrlPattern(pattern),
      requestStage: 'Request',
    }));
  } catch (validationError) {
    sendActionUpdate({ active: false, error: validationError.message }, currentTab.id);
    return;
  }

  const result = await attachDebuggerToTab(currentTab, validPatterns);
  if (result.status === 'SUCCESS') {
    sendActionUpdate({ active: true, message: result.message }, currentTab.id);
  } else {
    sendActionUpdate(
      { active: false, error: result.error || 'Failed to attach debugger' },
      currentTab.id
    );
    chrome.action.setBadgeText({ text: 'ERR', tabId: currentTab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#d9534f', tabId: currentTab.id });
  }
}

/**
 * Lightweight schema validation for incoming messages.
 * Returns null if valid, or an error string if invalid.
 * @param {*} message
 * @returns {string|null}
 */
function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return 'Message must be a non-null object';
  }
  if (Array.isArray(message)) {
    return 'Message must not be an array';
  }

  // Validate patterns message shape
  if (message.patterns !== undefined) {
    if (!Array.isArray(message.patterns)) {
      return '"patterns" must be an array';
    }
  }

  // Validate disconnect message shape
  if (message.disconnect !== undefined && typeof message.disconnect !== 'boolean') {
    return '"disconnect" must be a boolean';
  }

  // Validate getStatus message shape
  if (message.getStatus !== undefined && typeof message.getStatus !== 'boolean') {
    return '"getStatus" must be a boolean';
  }

  // Validate tabId when present
  if (message.tabId !== undefined && typeof message.tabId !== 'number') {
    return '"tabId" must be a number';
  }

  return null;
}

/**
 * Top-level chrome.runtime.onMessage handler.
 * Returns `true` to keep the message channel open for async response.
 */
export function handleMessage(message, sender, sendResponse) {
  // Ignore internal broadcast messages
  if (message && (message.status === 'INTERCEPTED' || message.status === 'ACTION_TOGGLE')) {
    return false;
  }

  console.info('Received message:', message);

  // Validate message schema before processing
  const validationError = validateMessage(message);
  if (validationError) {
    console.warn('Invalid message schema:', validationError);
    try {
      sendResponse({ status: 'ERROR', error: 'Invalid message: ' + validationError });
    } catch (_) {
      /* sendResponse may be invalid if message port closed */
    }
    return false;
  }

  (async () => {
    try {
      if (message.patterns !== undefined && message.patterns.length > 0) {
        await handlePatternsMessage(message, sendResponse);
      } else if (message.disconnect === true) {
        await handleDisconnectMessage(message, sendResponse);
      } else if (message.getStatus === true) {
        await handleStatusMessage(message, sendResponse);
      } else {
        sendResponse({ status: 'ERROR', error: 'Invalid message format or empty patterns' });
      }
    } catch (error) {
      console.error('Message handling error:', error);
      try {
        sendResponse({ status: 'ERROR', error: 'Internal error: ' + (error.message || 'Unknown') });
      } catch (_) {
        /* sendResponse may be invalid if message port closed */
      }
    }
  })();

  return true; // Keep message channel open for async response
}

// ── Internal message handlers ─────────────────────────────────────

async function getActiveTab() {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new Error('No active tab found');
  }
  return tabs[0];
}

async function handlePatternsMessage(message, sendResponse) {
  const validPatterns = [];
  const errors = [];

  for (const pattern of message.patterns) {
    try {
      if (!pattern || pattern.urlPattern === undefined) {
        throw new Error('Invalid pattern entry');
      }
      validPatterns.push({
        ...pattern,
        urlPattern: validateUrlPattern(pattern.urlPattern),
      });
    } catch (error) {
      errors.push(`Pattern "${pattern?.urlPattern || ''}": ${error.message}`);
    }
  }

  if (validPatterns.length === 0) {
    sendResponse({
      status: 'ERROR',
      error: 'No valid URL patterns provided. ' + errors.join('; '),
    });
    return;
  }

  let currentTab;
  try {
    if (message.tabId !== undefined) {
      currentTab = await getTab(message.tabId);
    } else {
      currentTab = await getActiveTab();
    }
  } catch (error) {
    sendResponse({ status: 'ERROR', error: error.message || 'Failed to get tab' });
    return;
  }

  const result = await attachDebuggerToTab(currentTab, validPatterns);
  sendResponse(result);
}

async function handleDisconnectMessage(message, sendResponse) {
  const targetTabId = message.tabId;

  if (targetTabId !== undefined) {
    console.log(`Detaching debugger session for tab id: ${targetTabId}`);
    const result = await detachDebuggerFromTab(targetTabId);
    sendResponse(result);
  } else {
    try {
      const currentTab = await getActiveTab();
      const result = await detachDebuggerFromTab(currentTab.id);
      sendResponse(result);
    } catch (error) {
      sendResponse({ status: 'WARNING', message: 'No tab specified' });
    }
  }
}

async function handleStatusMessage(message, sendResponse) {
  const queryTabId = message.tabId;
  if (queryTabId === undefined) {
    sendResponse({ status: 'ERROR', error: 'No tabId provided for status query' });
    return;
  }

  const isActive = await isDebuggerActive(queryTabId);
  sendResponse({
    status: 'SUCCESS',
    debuggerActive: isActive,
    tabId: queryTabId,
  });
}
