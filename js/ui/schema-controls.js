/**
 * Schema sidebar section: Load Schema button with endpoint auto-detection,
 * progress display, and per-endpoint caching in chrome.storage.local.
 * The service worker does the network work; this module converts the
 * introspection result to SDL and feeds the viewer.
 * @module ui/schema-controls
 */

import { introspectionToSDL, countIntrospectionTypes } from '../shared/introspection-to-sdl.js';
import { getElement } from './dom-helpers.js';
import { inspectedTabId } from './state.js';
import { setSchema, showMainTab, isSchemaLoaded } from './schema-viewer.js';
import {
  SCHEMA_STORAGE_KEY,
  SCHEMA_CACHE_STORAGE_KEY,
  SCHEMA_CACHE_MAX_BYTES,
} from '../shared/constants.js';

let isLoading = false;

function setStatus(text, isError = false) {
  const statusEl = getElement('schema-status');
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--color-error)' : '';
}

/**
 * Show live progress broadcast by the service worker during detection.
 * @param {string} message
 */
export function updateSchemaProgress(message) {
  if (isLoading && message) {
    setStatus(message);
  }
}

function updateClearButton() {
  const clearBtn = getElement('btn-clear-schema');
  if (clearBtn) clearBtn.disabled = !isSchemaLoaded() || isLoading;
}

function applySchema(sdl, meta) {
  setSchema(sdl, meta);
  const when = meta.fetchedAt ? new Date(meta.fetchedAt).toLocaleString() : '';
  setStatus(`${meta.typeCount} types loaded${when ? ` (${when})` : ''}`);
  updateClearButton();
}

function cacheSchema(endpoint, sdl, typeCount, fetchedAt) {
  if (sdl.length > SCHEMA_CACHE_MAX_BYTES) {
    console.warn('Schema too large to cache, skipping persistence');
    return;
  }
  chrome.storage.local.set(
    {
      [SCHEMA_STORAGE_KEY]: endpoint,
      [SCHEMA_CACHE_STORAGE_KEY]: { endpoint, sdl, typeCount, fetchedAt },
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to cache schema:', chrome.runtime.lastError);
      }
    }
  );
}

function handleLoadClick() {
  if (isLoading) return;

  const input = getElement('schema-url-input');
  const button = getElement('btn-load-schema');
  const url = input ? input.value.trim() : '';

  isLoading = true;
  updateClearButton();
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading...';
  }
  setStatus(url ? `Loading schema from ${url}...` : 'Detecting GraphQL endpoint...');

  const message = { loadSchema: true, tabId: inspectedTabId };
  if (url) message.url = url;

  chrome.runtime.sendMessage(message, (response) => {
    isLoading = false;
    updateClearButton();
    if (button) {
      button.disabled = false;
      button.textContent = 'Load Schema';
    }

    if (chrome.runtime.lastError) {
      setStatus(`Failed: ${chrome.runtime.lastError.message}`, true);
      return;
    }

    if (!response || response.status !== 'SUCCESS') {
      setStatus(response?.error || 'Schema load failed', true);
      return;
    }

    try {
      const sdl = introspectionToSDL(response.introspection);
      const typeCount = countIntrospectionTypes(response.introspection);
      const fetchedAt = Date.now();

      if (input) input.value = response.endpoint;
      cacheSchema(response.endpoint, sdl, typeCount, fetchedAt);
      applySchema(sdl, { endpoint: response.endpoint, typeCount, fetchedAt });
      showMainTab('schema');
    } catch (error) {
      console.error('Failed to build schema:', error);
      setStatus(`Invalid introspection result: ${error.message}`, true);
    }
  });
}

function handleClearClick() {
  if (isLoading || !isSchemaLoaded()) return;

  setSchema(null);
  setStatus('No schema loaded');
  updateClearButton();

  chrome.storage.local.remove([SCHEMA_STORAGE_KEY, SCHEMA_CACHE_STORAGE_KEY], () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to clear cached schema:', chrome.runtime.lastError);
    }
  });
}

function restoreFromCache() {
  chrome.storage.local.get([SCHEMA_STORAGE_KEY, SCHEMA_CACHE_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) return;

    const savedUrl = result[SCHEMA_STORAGE_KEY];
    const input = getElement('schema-url-input');
    if (input && typeof savedUrl === 'string' && savedUrl) {
      input.value = savedUrl;
    }

    const cache = result[SCHEMA_CACHE_STORAGE_KEY];
    if (cache && typeof cache === 'object' && cache.sdl && cache.endpoint) {
      applySchema(cache.sdl, {
        endpoint: cache.endpoint,
        typeCount: cache.typeCount || 0,
        fetchedAt: cache.fetchedAt,
      });
    }
  });
}

/**
 * Wire up the Load Schema button and restore any cached schema.
 */
export function initSchemaControls() {
  const button = getElement('btn-load-schema');
  if (button) {
    button.addEventListener('click', handleLoadClick);
  }

  const clearBtn = getElement('btn-clear-schema');
  if (clearBtn) {
    clearBtn.addEventListener('click', handleClearClick);
  }

  const input = getElement('schema-url-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLoadClick();
      }
    });
  }

  restoreFromCache();
  updateClearButton();
}
