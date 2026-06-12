/**
 * Hash registry: maps APQ hashes to their resolved queries.
 * In passive mode, the registry resolves queries without contamination.
 * @module sw/hash-registry
 */

import { storageGet, storageSet } from './chrome-api.js';
import { HASH_REGISTRY_STORAGE_KEY, PASSIVE_MODE_STORAGE_KEY } from '../shared/constants.js';
import { log } from '../shared/logger.js';

const registry = new Map();
let passiveMode = false;

export async function initRegistry() {
  try {
    const result = await storageGet([HASH_REGISTRY_STORAGE_KEY, PASSIVE_MODE_STORAGE_KEY]);

    const stored = result[HASH_REGISTRY_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      for (const [hash, entry] of Object.entries(stored)) {
        registry.set(hash, entry);
      }
      log.info(`Loaded ${registry.size} entries from hash registry`);
    }

    passiveMode = !!result[PASSIVE_MODE_STORAGE_KEY];
  } catch (error) {
    log.error('Failed to load hash registry:', error);
  }
}

export function registerHash(hash, data) {
  if (!hash || typeof hash !== 'string') return;
  const wasNew = !registry.has(hash);
  registry.set(hash, {
    query: data.query || '',
    operationName: data.operationName || '',
    variables: data.variables || null,
    registeredAt: Date.now(),
  });
  persistRegistry();
  if (wasNew) broadcastRegistryUpdate();
}

export function lookupHash(hash) {
  return registry.get(hash) || null;
}

export function getRegistrySize() {
  return registry.size;
}

export function clearRegistry() {
  registry.clear();
  persistRegistry();
  broadcastRegistryUpdate();
}

export function getRegistryEntries() {
  const entries = {};
  for (const [hash, data] of registry) {
    entries[hash] = data;
  }
  return entries;
}

export function isPassiveMode() {
  return passiveMode;
}

export async function setPassiveMode(enabled) {
  passiveMode = !!enabled;
  try {
    await storageSet({ [PASSIVE_MODE_STORAGE_KEY]: passiveMode });
  } catch (error) {
    log.error('Failed to persist passive mode:', error);
  }
  broadcastRegistryUpdate();
}

async function persistRegistry() {
  try {
    const obj = {};
    for (const [hash, data] of registry) {
      obj[hash] = data;
    }
    await storageSet({ [HASH_REGISTRY_STORAGE_KEY]: obj });
  } catch (error) {
    log.error('Failed to persist hash registry:', error);
  }
}

function broadcastRegistryUpdate() {
  try {
    chrome.runtime.sendMessage(
      { status: 'REGISTRY_UPDATED', size: registry.size, passiveMode },
      () => {
        if (chrome.runtime.lastError) {
          // No listener — DevTools panel not open
        }
      }
    );
  } catch (_) {
    /* runtime not available */
  }
}
