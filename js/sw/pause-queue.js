/**
 * Queue of GraphQL requests held in Chrome's Fetch domain while the user edits them.
 * Persisted in chrome.storage.session so a restarted service worker still knows
 * which requests are paused.
 * @module sw/pause-queue
 */

import { PAUSED_QUEUE_STORAGE_KEY, MAX_PAUSED_PER_TAB } from '../shared/constants.js';
import { sessionGet, sessionSet, sendDebuggerCommand } from './chrome-api.js';

/**
 * @typedef {object} HeldOperation
 * @property {number} index
 * @property {string} operationName
 * @property {string} query
 * @property {'request'|'registry'|'none'} querySource
 * @property {object|null} variables
 * @property {string} hash
 * @property {boolean} isHashOnly
 */

/**
 * @typedef {object} HeldRequest
 * @property {string} id - Fetch requestId.
 * @property {string} networkId
 * @property {number} tabId
 * @property {string} url
 * @property {string} method
 * @property {number} heldAt
 * @property {'breakpoint'|'pause-next'} reason
 * @property {'paused'|'cancelled'} state
 * @property {object|object[]} body - Body as it would be sent unedited.
 * @property {Record<string,string>} rawHeaders
 * @property {HeldOperation[]} operations
 */

/** @type {Map<number, HeldRequest[]>} */
const queue = new Map();
/** @type {Promise<void>|null} */
let loadPromise = null;
const listeners = [];

/**
 * Restore the queue from session storage (once per service worker lifetime).
 * @returns {Promise<void>}
 */
export function ensurePausedLoaded() {
  if (!loadPromise) {
    loadPromise = sessionGet(PAUSED_QUEUE_STORAGE_KEY)
      .then((result) => {
        const stored = (result && result[PAUSED_QUEUE_STORAGE_KEY]) || {};
        for (const [tabId, items] of Object.entries(stored)) {
          if (Array.isArray(items) && items.length && !queue.has(Number(tabId))) {
            queue.set(Number(tabId), items);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load paused queue:', err);
      });
  }
  return loadPromise;
}

async function persist() {
  const obj = {};
  for (const [tabId, items] of queue) obj[tabId] = items;
  try {
    await sessionSet({ [PAUSED_QUEUE_STORAGE_KEY]: obj });
  } catch (err) {
    console.warn('Failed to persist paused queue:', err);
  }
}

function notify(tabId) {
  for (const listener of listeners) {
    try {
      listener(tabId);
    } catch (err) {
      console.warn('Paused queue listener failed:', err);
    }
  }
}

async function commit(tabId) {
  if (queue.get(tabId) && queue.get(tabId).length === 0) queue.delete(tabId);
  await persist();
  notify(tabId);
}

/**
 * Register a listener called with the tabId after every queue mutation.
 * @param {(tabId: number) => void} listener
 * @returns {void}
 */
export function onQueueChanged(listener) {
  listeners.push(listener);
}

/**
 * Add a request to the queue.
 * @param {HeldRequest} req
 * @returns {Promise<boolean>} False when the tab is at capacity (caller must continue unmodified).
 */
export async function holdRequest(req) {
  await ensurePausedLoaded();
  const items = queue.get(req.tabId) || [];
  if (items.length >= MAX_PAUSED_PER_TAB) return false;
  items.push(req);
  queue.set(req.tabId, items);
  await commit(req.tabId);
  return true;
}

/**
 * Held requests for a tab, oldest first. Requires a prior `ensurePausedLoaded()`.
 * @param {number} tabId
 * @returns {HeldRequest[]}
 */
export function listPaused(tabId) {
  return (queue.get(tabId) || []).slice();
}

/**
 * Look up a held request. Requires a prior `ensurePausedLoaded()`.
 * @param {number} tabId
 * @param {string} id - Fetch requestId.
 * @returns {HeldRequest|null}
 */
export function getHeld(tabId, id) {
  return (queue.get(tabId) || []).find((r) => r.id === id) || null;
}

/**
 * Remove a held request from the queue without sending anything.
 * @param {number} tabId
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeHeld(tabId, id) {
  await ensurePausedLoaded();
  const items = queue.get(tabId);
  if (!items) return;
  const next = items.filter((r) => r.id !== id);
  if (next.length === items.length) return;
  queue.set(tabId, next);
  await commit(tabId);
}

/**
 * Flag a held request as cancelled by the page (matched by network id).
 * @param {number} tabId
 * @param {string} networkId
 * @returns {Promise<boolean>} True when a paused item was flipped.
 */
export async function markCancelled(tabId, networkId) {
  await ensurePausedLoaded();
  const item = (queue.get(tabId) || []).find(
    (r) => r.networkId === networkId && r.state === 'paused'
  );
  if (!item) return false;
  item.state = 'cancelled';
  await commit(tabId);
  return true;
}

async function flagCancelled(tabId, item) {
  item.state = 'cancelled';
  await commit(tabId);
  return 'cancelled';
}

/**
 * Resume a held request, optionally with an edited body/headers.
 * @param {number} tabId
 * @param {string} id
 * @param {{ postData?: string, headers?: {name: string, value: string}[] }} [params]
 * @returns {Promise<'sent'|'cancelled'>}
 */
export async function continueHeld(tabId, id, params = {}) {
  await ensurePausedLoaded();
  const item = getHeld(tabId, id);
  if (!item) return 'cancelled';
  if (item.state === 'cancelled') return 'cancelled';
  try {
    await sendDebuggerCommand(tabId, 'Fetch.continueRequest', { requestId: id, ...params });
  } catch {
    return flagCancelled(tabId, item);
  }
  await removeHeld(tabId, id);
  return 'sent';
}

/**
 * Abort a held request. A request already cancelled by the page is just removed.
 * @param {number} tabId
 * @param {string} id
 * @returns {Promise<'failed'|'cancelled'>}
 */
export async function failHeld(tabId, id) {
  await ensurePausedLoaded();
  const item = getHeld(tabId, id);
  if (!item) return 'cancelled';
  if (item.state === 'cancelled') {
    await removeHeld(tabId, id);
    return 'cancelled';
  }
  try {
    await sendDebuggerCommand(tabId, 'Fetch.failRequest', {
      requestId: id,
      errorReason: 'Aborted',
    });
  } catch {
    return flagCancelled(tabId, item);
  }
  await removeHeld(tabId, id);
  return 'failed';
}

/**
 * Continue every paused request for a tab unmodified and clear the tab.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function releaseAll(tabId) {
  await ensurePausedLoaded();
  const items = listPaused(tabId);
  await Promise.all(
    items
      .filter((r) => r.state === 'paused')
      .map((r) =>
        sendDebuggerCommand(tabId, 'Fetch.continueRequest', { requestId: r.id }).catch(() => {})
      )
  );
  if (queue.has(tabId)) {
    queue.delete(tabId);
    await persist();
    notify(tabId);
  }
}

/**
 * Clear a tab's queue without sending anything (debugger already detached).
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function dropTab(tabId) {
  await ensurePausedLoaded();
  if (!queue.has(tabId)) return;
  queue.delete(tabId);
  await persist();
  notify(tabId);
}
