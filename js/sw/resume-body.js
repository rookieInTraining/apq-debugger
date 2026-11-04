/**
 * Builds Fetch.continueRequest params for a held request from the user's edits.
 * @module sw/resume-body
 */

import { BASE64_CHUNK_SIZE } from '../shared/constants.js';
import { digestMessage } from './hash.js';

/**
 * @typedef {object} ResumeEdits
 * @property {{index: number, query?: string, variables?: object|null}[]} [operations]
 * @property {Record<string,string>} [headers]
 */

/**
 * Encode a value as base64 JSON (UTF-8, chunked to avoid stack overflow on large payloads).
 * @param {unknown} value
 * @returns {string}
 */
export function encodeBase64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Apply one operation edit to a (cloned) operation object.
 * @param {object} target - Operation object inside the cloned body.
 * @param {{query?: string, variables?: object|null}} edit
 * @param {import('./pause-queue.js').HeldOperation|undefined} reference
 * @returns {Promise<boolean>} True if the operation changed.
 */
async function applyOperationEdit(target, edit, reference) {
  let changed = false;

  if (typeof edit.query === 'string') {
    const originalQuery = reference ? reference.query : target.query;
    if (edit.query !== originalQuery) {
      target.query = edit.query;
      changed = true;
      const pq = target.extensions && target.extensions.persistedQuery;
      if (pq) {
        const hash = await digestMessage(edit.query);
        if (hash) pq.sha256Hash = hash;
      }
    }
  }

  if (edit.variables !== undefined) {
    const originalVariables = reference ? reference.variables : target.variables;
    if (JSON.stringify(edit.variables) !== JSON.stringify(originalVariables)) {
      target.variables = edit.variables;
      changed = true;
    }
  }

  return changed;
}

/**
 * @param {Record<string,string>} obj
 * @returns {[string, string][]}
 */
function sortedEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Compute the Fetch.continueRequest overrides for a held request.
 * @param {import('./pause-queue.js').HeldRequest} held
 * @param {ResumeEdits} [edits]
 * @returns {Promise<{postData?: string, headers?: {name: string, value: string}[]}>}
 *   Empty object when nothing differs from the held request.
 */
export async function buildContinueParams(held, edits = {}) {
  const params = {};

  const opEdits = Array.isArray(edits.operations) ? edits.operations : [];
  if (opEdits.length) {
    const body = JSON.parse(JSON.stringify(held.body));
    let changed = false;
    for (const edit of opEdits) {
      const target = Array.isArray(body) ? body[edit.index] : edit.index === 0 ? body : undefined;
      if (!target || typeof target !== 'object') continue;
      const reference = (held.operations || []).find((op) => op.index === edit.index);
      if (await applyOperationEdit(target, edit, reference)) changed = true;
    }
    if (changed) params.postData = encodeBase64Json(body);
  }

  if (edits.headers) {
    const next = sortedEntries(edits.headers);
    if (JSON.stringify(next) !== JSON.stringify(sortedEntries(held.rawHeaders || {}))) {
      params.headers = next.map(([name, value]) => ({ name, value }));
    }
  }

  return params;
}
