/**
 * Debugger lifecycle management: attach, detach, restore, and state tracking.
 * @module sw/debugger-manager
 */

import {
  getTargets,
  attachDebugger as chromeAttachDebugger,
  detachDebugger as chromeDetachDebugger,
  sendDebuggerCommand
} from './chrome-api.js';
import {
  saveTabToStorage,
  removeTabFromStorage,
  getStoredTabs,
  setStoredTabs
} from './storage.js';

/** Set of tab IDs with an active debugger session managed by this extension. */
export const attachedTabs = new Set();

/**
 * Validate a URL pattern string for safety and correctness.
 * @param {string} pattern - The URL pattern to validate.
 * @returns {string} The trimmed, validated pattern.
 * @throws {Error} If the pattern is invalid.
 */
export function validateUrlPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid URL pattern: must be a non-empty string');
  }

  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid URL pattern: cannot be empty');
  }

  if (trimmed.length > 1000) {
    throw new Error('Invalid URL pattern: too long (max 1000 characters)');
  }

  if (trimmed.includes('<script') || trimmed.includes('javascript:')) {
    throw new Error('Invalid URL pattern: contains potentially dangerous content');
  }

  return trimmed;
}

/**
 * Check whether the debugger is currently attached to a given tab.
 * First checks in-memory state, then persistent storage, then the Chrome API.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function isDebuggerActive(tabId) {
  // Fast path: check in-memory state first
  if (attachedTabs.has(tabId)) {
    return true;
  }

  // Fallback: check persistent storage for recovery after SW restart
  try {
    const storedTabs = await getStoredTabs();

    if (!storedTabs.includes(tabId)) {
      return false;
    }

    // Tab is in our stored list — verify it's still attached via Chrome API
    const targets = await getTargets();
    const target = targets.find(t => t.tabId === tabId && t.attached);

    if (target) {
      // Recover state: tab is in storage AND has debugger attached
      attachedTabs.add(tabId);
      console.log(`Recovered debugger session for tab ${tabId}`);
      return true;
    } else {
      // Tab in storage but no longer attached — clean up
      removeTabFromStorage(tabId);
      return false;
    }
  } catch (error) {
    console.error('Failed to check debugger state:', error);
    return false;
  }
}

/**
 * Attach the Chrome debugger to a tab and enable Fetch interception.
 * @param {chrome.tabs.Tab} currentTab
 * @param {Array<{urlPattern: string, requestStage?: string}>} validPatterns
 * @returns {Promise<{status: string, message?: string, error?: string}>}
 */
export async function attachDebuggerToTab(currentTab, validPatterns) {
  if (!currentTab.url || !currentTab.url.startsWith('http')) {
    return { status: "ERROR", error: "Debugger can only be attached to HTTP/HTTPS pages" };
  }

  const alreadyAttached = await isDebuggerActive(currentTab.id);
  if (alreadyAttached) {
    return { status: "WARNING", message: "Debugger already attached to this tab" };
  }

  try {
    await chromeAttachDebugger(currentTab.id);
  } catch (error) {
    console.error('Debugger attach failed:', error);
    const errorMessage = error.message || safeStringify(error) || "Unknown error";
    return { status: "ERROR", error: "Failed to attach debugger: " + errorMessage };
  }

  try {
    await sendDebuggerCommand(currentTab.id, "Fetch.enable", {
      patterns: validPatterns.map(pattern => ({
        urlPattern: pattern.urlPattern,
        requestStage: pattern.requestStage || "Request"
      }))
    });
  } catch (error) {
    console.error('Fetch.enable failed:', error);
    try { await chromeDetachDebugger(currentTab.id); } catch (_) { /* best-effort cleanup */ }
    return { status: "ERROR", error: "Failed to enable network interception" };
  }

  attachedTabs.add(currentTab.id);
  saveTabToStorage(currentTab.id);
  chrome.action.setBadgeText({ text: "ON", tabId: currentTab.id });
  chrome.action.setBadgeBackgroundColor({ color: "#5cb85c", tabId: currentTab.id });

  return { status: "SUCCESS", message: "Network Interception enabled for logic" };
}

/**
 * Detach the Chrome debugger from a tab and clean up state.
 * @param {number} detachTabId
 * @returns {Promise<{status: string, message?: string, error?: string}>}
 */
export async function detachDebuggerFromTab(detachTabId) {
  const isAttached = await isDebuggerActive(detachTabId);

  if (!isAttached) {
    cleanupTabState(detachTabId);
    return { status: "SUCCESS", message: "Debugger already detached" };
  }

  try {
    await chromeDetachDebugger(detachTabId);
  } catch (error) {
    console.error('Debugger detach failed:', error);
    const errorMessage = error.message || safeStringify(error) || "Unknown error";

    cleanupTabState(detachTabId);

    // If the session was already gone, treat as success
    if (errorMessage.includes("Session not found") ||
        errorMessage.includes("Detached") ||
        errorMessage.includes("Debugger is not attached")) {
      console.log("Debugger already detached, treating as success.");
      return { status: "SUCCESS", message: "Debugger detached successfully (Session was already gone)" };
    }

    return { status: "ERROR", error: "Failed to detach debugger: " + errorMessage };
  }

  cleanupTabState(detachTabId);
  return { status: "SUCCESS", message: "Debugger detached successfully" };
}

/**
 * Restore debugger state from persistent storage after SW restart.
 * Cross-references stored tabs with actual Chrome debugger targets.
 */
export async function restoreDebuggerState() {
  try {
    const storedTabs = await getStoredTabs();

    if (storedTabs.length === 0) {
      console.log('No stored tabs to restore');
      attachedTabs.clear();
      return;
    }

    const targets = await getTargets();
    attachedTabs.clear();
    const stillAttached = [];

    for (const tabId of storedTabs) {
      const target = targets.find(t => t.tabId === tabId && t.attached);
      if (target) {
        attachedTabs.add(tabId);
        stillAttached.push(tabId);
        chrome.action.setBadgeText({ text: "ON", tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#5cb85c", tabId });
      }
    }

    if (stillAttached.length !== storedTabs.length) {
      await setStoredTabs(stillAttached);
    }

    console.log('Restored debugger state for tabs:', stillAttached);
  } catch (error) {
    console.error('Failed to restore debugger state:', error);
  }
}

// ── Internal helpers ──────────────────────────────────────────────

function cleanupTabState(tabId) {
  attachedTabs.delete(tabId);
  removeTabFromStorage(tabId);
  chrome.action.setBadgeText({ text: "OFF", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#d9534f", tabId });
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return "Error object could not be stringified";
  }
}
