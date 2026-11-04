/**
 * Service worker entry point.
 * Wires together all modules and registers Chrome event listeners.
 */

import { getTargets } from './chrome-api.js';
import { attachedTabs, restoreDebuggerState, syncNetworkEvents } from './debugger-manager.js';
import { removeTabFromStorage, getStoredTabs } from './storage.js';
import { handleFetchRequestPaused } from './interceptor.js';
import { handleMessage, toggleDebuggerFromAction, broadcastPausedUpdate } from './messaging.js';
import { initRegistry } from './hash-registry.js';
import { clearObservedEndpoints } from './endpoint-tracker.js';
import { initBreakpoints, setPauseNext, clearDebugState } from './breakpoints.js';
import {
  ensurePausedLoaded,
  onQueueChanged,
  releaseAll,
  dropTab,
  markCancelled,
} from './pause-queue.js';
import { initPanelPresence } from './panel-presence.js';
import { trackEvent } from './analytics.js';

const ACTION_MENU_ID = 'apq-toggle-debugger';

// Load the persisted hash registry and passive-mode flag on every SW start
// (MV3 service workers are terminated and restarted frequently).
initRegistry();

/**
 * Log a rejected background task instead of leaving it unhandled.
 * @param {Promise<unknown>} promise
 * @param {string} what - Description for the log.
 */
function logFailure(promise, what) {
  promise.catch((error) => console.error(`${what} failed:`, error));
}

// Request breakpoints: breakpoint list, per-tab debug state and the paused
// queue are persisted, so they are reloaded on every SW start too.
logFailure(initBreakpoints(), 'Loading breakpoints');
logFailure(ensurePausedLoaded(), 'Loading paused queue');
onQueueChanged((tabId) => logFailure(broadcastPausedUpdate(tabId), 'Paused queue broadcast'));

// When the last panel for a tab closes, nothing could resume its held
// requests: send them on unmodified and disarm pause-next.
initPanelPresence((tabId) => {
  logFailure(releaseAll(tabId), 'Releasing held requests');
  logFailure(
    setPauseNext(tabId, false).then(() => syncNetworkEvents(tabId)),
    'Clearing pause-next'
  );
});

// ── Global error handling ─────────────────────────────────────────

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in service worker:', event.reason);
});

// ── Message routing ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return handleMessage(message, sender, sendResponse);
});

// ── Debugger events ───────────────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  try {
    if (method === 'Fetch.requestPaused') {
      console.info('Request paused:', params);
      handleFetchRequestPaused(source, params);
    } else if (
      method === 'Page.frameNavigated' &&
      params &&
      params.frame &&
      !params.frame.parentId
    ) {
      // Cross-document navigation of the main frame (same-document navigations
      // fire Page.navigatedWithinDocument instead): the old page's held requests
      // go on unmodified. Pause-next stays armed for the new page.
      logFailure(releaseAll(source.tabId), 'Releasing held requests');
    } else if (method === 'Network.loadingFailed' && params && params.canceled === true) {
      // The page gave up on a request; flag it if it is held
      logFailure(markCancelled(source.tabId, params.requestId), 'Marking request cancelled');
    }
  } catch (error) {
    console.error('Debugger event handling error:', error);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ID ${source.tabId}. Reason: ${reason}`);

  attachedTabs.delete(source.tabId);
  removeTabFromStorage(source.tabId);
  chrome.action.setBadgeText({ text: 'OFF', tabId: source.tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#d9534f', tabId: source.tabId });

  // Chrome releases paused requests when the debugger goes; just clear the queue
  logFailure(dropTab(source.tabId), 'Dropping paused queue');

  if (reason === 'target_closed') {
    logFailure(clearDebugState(source.tabId), 'Clearing debug state');
    clearObservedEndpoints(source.tabId);
    console.log('The target tab was closed.');
  } else if (reason === 'canceled_by_user') {
    console.log('The debugging session was manually detached by the user.');
    // The user dismissed Chrome's "started debugging" infobar
    trackEvent('interception_stop', { trigger: 'chrome' });
  } else {
    console.log('Debugger detached for an unknown reason.');
  }
});

// ── Lifecycle events ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('GraphQL Debugger service worker installed/updated');

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ACTION_MENU_ID,
      title: 'Toggle GraphQL Debugger',
      contexts: ['action'],
    });
  });

  restoreDebuggerState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('GraphQL Debugger service worker starting up');
  restoreDebuggerState();
});

// ── Action button & context menu ──────────────────────────────────

chrome.action.onClicked.addListener(() => {
  toggleDebuggerFromAction();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === ACTION_MENU_ID) {
    toggleDebuggerFromAction();
  }
});

// ── Tab navigation handling ───────────────────────────────────────

// Held requests are released on navigation by Page.frameNavigated (above).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') {
    return;
  }

  try {
    const storedTabs = await getStoredTabs();
    if (!storedTabs.includes(tabId)) {
      return;
    }

    const targets = await getTargets();
    const target = targets.find((t) => t.tabId === tabId && t.attached);

    if (target) {
      attachedTabs.add(tabId);
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#5cb85c', tabId });
      console.log(`Restored badge for tab ${tabId} after navigation`);
    } else {
      removeTabFromStorage(tabId);
      attachedTabs.delete(tabId);
    }
  } catch (error) {
    console.error('Failed to handle tab update:', error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Closed tab: forget its paused queue and debug state
  logFailure(dropTab(tabId), 'Dropping paused queue');
  logFailure(clearDebugState(tabId), 'Clearing debug state');
});
