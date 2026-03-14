/**
 * Chrome storage helpers for patterns and attached tabs.
 * @module sw/storage
 */

import { storageGet, storageSet } from './chrome-api.js';

/** Storage key for persisted URL patterns. */
export const PATTERNS_STORAGE_KEY = 'apqPatterns';

/** Storage key for the list of tabs with an active debugger session. */
export const ATTACHED_TABS_STORAGE_KEY = 'apqAttachedTabs';

/**
 * Add a tab ID to the persisted list of attached tabs.
 * No-op if the tab is already stored.
 * @param {number} tabId - The tab ID to persist.
 * @returns {Promise<void>}
 */
export async function saveTabToStorage(tabId) {
  try {
    const result = await storageGet([ATTACHED_TABS_STORAGE_KEY]);
    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    if (!storedTabs.includes(tabId)) {
      storedTabs.push(tabId);
      await storageSet({ [ATTACHED_TABS_STORAGE_KEY]: storedTabs });
    }
  } catch (error) {
    console.error('Failed to save tab to storage:', error);
  }
}

/**
 * Remove a tab ID from the persisted list of attached tabs.
 * No-op if the tab is not in storage.
 * @param {number} tabId - The tab ID to remove.
 * @returns {Promise<void>}
 */
export async function removeTabFromStorage(tabId) {
  try {
    const result = await storageGet([ATTACHED_TABS_STORAGE_KEY]);
    const storedTabs = Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];

    const index = storedTabs.indexOf(tabId);
    if (index > -1) {
      storedTabs.splice(index, 1);
      await storageSet({ [ATTACHED_TABS_STORAGE_KEY]: storedTabs });
    }
  } catch (error) {
    console.error('Failed to remove tab from storage:', error);
  }
}

/**
 * Retrieve the persisted URL patterns from storage.
 * @returns {Promise<string[]>} Array of URL pattern strings (empty if none stored).
 */
export async function getStoredPatterns() {
  try {
    const result = await storageGet([PATTERNS_STORAGE_KEY]);
    return Array.isArray(result[PATTERNS_STORAGE_KEY]) ? result[PATTERNS_STORAGE_KEY] : [];
  } catch (error) {
    console.error('Failed to load saved patterns:', error);
    return [];
  }
}

/**
 * Retrieve the persisted list of attached tab IDs from storage.
 * @returns {Promise<number[]>} Array of tab IDs (empty if none stored).
 */
export async function getStoredTabs() {
  try {
    const result = await storageGet([ATTACHED_TABS_STORAGE_KEY]);
    return Array.isArray(result[ATTACHED_TABS_STORAGE_KEY])
      ? result[ATTACHED_TABS_STORAGE_KEY]
      : [];
  } catch (error) {
    console.error('Failed to get stored tabs:', error);
    return [];
  }
}

/**
 * Overwrite the persisted list of attached tab IDs in storage.
 * @param {number[]} tabs - The complete list of tab IDs to store.
 * @returns {Promise<void>}
 */
export async function setStoredTabs(tabs) {
  try {
    await storageSet({ [ATTACHED_TABS_STORAGE_KEY]: tabs });
  } catch (error) {
    console.error('Failed to set stored tabs:', error);
  }
}
