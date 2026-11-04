/**
 * Breakpoint store and pause decision.
 * The breakpoint list lives in `chrome.storage.local`; per-tab debug state
 * (debug mode, pause-on-next) lives in `chrome.storage.session`. In-memory
 * copies are a cache: callers must `await initBreakpoints()` on every
 * service-worker start before using the synchronous getters.
 * @module sw/breakpoints
 */

import { storageGet, storageSet, sessionGet, sessionSet } from './chrome-api.js';
import {
  BREAKPOINTS_STORAGE_KEY,
  DEBUG_STATE_STORAGE_KEY,
  MAX_BREAKPOINTS,
} from '../shared/constants.js';

/**
 * @typedef {{ name: string, enabled: boolean }} Breakpoint
 */

/** @type {Breakpoint[]} */
let breakpoints = [];
/** @type {Record<string, { debugMode: boolean, pauseNext: boolean }>} */
let debugStates = {};
/** @type {Promise<void>|null} */
let initPromise = null;

/**
 * Load the breakpoint list and per-tab debug state from storage.
 * Idempotent: repeat calls return the same promise.
 * @returns {Promise<void>}
 */
export function initBreakpoints() {
  if (!initPromise) {
    initPromise = (async () => {
      const local = await storageGet(BREAKPOINTS_STORAGE_KEY);
      const session = await sessionGet(DEBUG_STATE_STORAGE_KEY);
      const list = local && local[BREAKPOINTS_STORAGE_KEY];
      breakpoints = Array.isArray(list) ? list : [];
      const states = session && session[DEBUG_STATE_STORAGE_KEY];
      debugStates = states && typeof states === 'object' ? states : {};
    })();
  }
  return initPromise;
}

/**
 * Get the current breakpoint list.
 * @returns {Breakpoint[]}
 */
export function getBreakpoints() {
  return breakpoints;
}

/**
 * Replace the breakpoint list. Names are trimmed; empty and duplicate names
 * are dropped (first wins); the list is capped at MAX_BREAKPOINTS.
 * @param {Breakpoint[]} list - Proposed list.
 * @returns {Promise<Breakpoint[]>} The list as stored.
 */
export async function setBreakpoints(list) {
  const seen = new Set();
  const clean = [];
  for (const bp of Array.isArray(list) ? list : []) {
    const name = typeof bp?.name === 'string' ? bp.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    clean.push({ name, enabled: !!bp.enabled });
    if (clean.length >= MAX_BREAKPOINTS) break;
  }
  breakpoints = clean;
  await storageSet({ [BREAKPOINTS_STORAGE_KEY]: clean });
  return clean;
}

/**
 * Get the debug state for a tab.
 * @param {number} tabId - Tab ID.
 * @returns {{ debugMode: boolean, pauseNext: boolean }}
 */
export function getDebugState(tabId) {
  const s = debugStates[tabId];
  return { debugMode: !!s?.debugMode, pauseNext: !!s?.pauseNext };
}

/**
 * Persist the in-memory debug state to session storage.
 * @returns {Promise<void>}
 */
function persistDebugStates() {
  return sessionSet({ [DEBUG_STATE_STORAGE_KEY]: debugStates });
}

/**
 * Update one flag for a tab and persist.
 * @param {number} tabId - Tab ID.
 * @param {'debugMode'|'pauseNext'} key - Flag to set.
 * @param {boolean} on - New value.
 * @returns {Promise<void>}
 */
function setFlag(tabId, key, on) {
  debugStates[tabId] = { ...getDebugState(tabId), [key]: !!on };
  return persistDebugStates();
}

/**
 * Turn debug mode on or off for a tab.
 * @param {number} tabId - Tab ID.
 * @param {boolean} on - Whether debug mode is enabled.
 * @returns {Promise<void>}
 */
export function setDebugMode(tabId, on) {
  return setFlag(tabId, 'debugMode', on);
}

/**
 * Arm or disarm pause-on-next for a tab.
 * @param {number} tabId - Tab ID.
 * @param {boolean} on - Whether the next request should pause.
 * @returns {Promise<void>}
 */
export function setPauseNext(tabId, on) {
  return setFlag(tabId, 'pauseNext', on);
}

/**
 * Forget all debug state for a tab.
 * @param {number} tabId - Tab ID.
 * @returns {Promise<void>}
 */
export function clearDebugState(tabId) {
  delete debugStates[tabId];
  return persistDebugStates();
}

/**
 * Decide whether a request should pause. Pure read; does not consume pause-next.
 * Hash-only requests pause only in passive mode (in active mode they are
 * contaminated and the full-query retry is what pauses).
 * @param {{ operationName: string, isHashOnly: boolean }} op - Operation info.
 * @param {{ tabId: number, passive: boolean }} ctx - Request context.
 * @returns {null|'breakpoint'|'pause-next'} Pause reason, or null to continue.
 */
export function decidePause(op, ctx) {
  if (op.isHashOnly && !ctx.passive) return null;
  const state = getDebugState(ctx.tabId);
  if (state.pauseNext) return 'pause-next';
  if (
    state.debugMode &&
    op.operationName &&
    breakpoints.some((b) => b.enabled && b.name === op.operationName)
  ) {
    return 'breakpoint';
  }
  return null;
}

/**
 * Consume the one-shot pause-on-next flag for a tab.
 * @param {number} tabId - Tab ID.
 * @returns {Promise<void>}
 */
export function consumePauseNext(tabId) {
  return setPauseNext(tabId, false);
}
