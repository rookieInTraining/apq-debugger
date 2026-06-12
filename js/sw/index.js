/**
 * Service worker entry point.
 * Wires together all modules and registers Chrome event listeners.
 */

import { getTargets } from './chrome-api.js';
import { attachedTabs, restoreDebuggerState } from './debugger-manager.js';
import { removeTabFromStorage, getStoredTabs } from './storage.js';
import { handleFetchRequestPaused } from './interceptor.js';
import { handleMessage, toggleDebuggerFromAction } from './messaging.js';
import { initRegistry } from './hash-registry.js';
import { clearObservedEndpoints } from './endpoint-tracker.js';

const ACTION_MENU_ID = 'apq-toggle-debugger';

// Load the persisted hash registry and passive-mode flag on every SW start
// (MV3 service workers are terminated and restarted frequently).
initRegistry();

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

  if (reason === 'target_closed') {
    clearObservedEndpoints(source.tabId);
    console.log('The target tab was closed.');
  } else if (reason === 'canceled_by_user') {
    console.log('The debugging session was manually detached by the user.');
  } else {
    console.log('Debugger detached for an unknown reason.');
  }
});

// ── Lifecycle events ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('APQ Debugger service worker installed/updated');

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: ACTION_MENU_ID,
      title: 'Toggle APQ Debugger',
      contexts: ['action'],
    });
  });

  restoreDebuggerState();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('APQ Debugger service worker starting up');
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
