/**
 * What a captured request means to the user: resolved, waiting for the
 * APQ retry, unknown to the registry, or a plain full-query request.
 * Shared by the request list and the detail panel so both use the same
 * words.
 * @module ui/request-state
 */

import { DEFAULT_OPERATION_NAME } from '../shared/constants.js';

/** Placeholder names the worker and panel use when a payload has none. */
const ANONYMOUS_NAMES = new Set([DEFAULT_OPERATION_NAME, 'Unknown Query', 'Unknown', '']);

/**
 * @param {string} name
 * @returns {boolean} True when the operation carried no name of its own.
 */
export function isAnonymousOperation(name) {
  return ANONYMOUS_NAMES.has(name || '');
}

/**
 * Classify a request for display.
 * @param {{type: string, query: string, hash: string, capturedPassive?: boolean}} request
 * @returns {{key: 'resolved'|'pending'|'unknown'|'retry'|'full', label: string, description: string}}
 */
export function getRequestState(request) {
  if (request.type === 'full') {
    return request.hash
      ? {
          key: 'retry',
          label: 'APQ retry',
          description:
            'Apollo re-sent the operation with its full query after the hash was rejected. The matching hash row is now resolved.',
        }
      : {
          key: 'full',
          label: 'Full query',
          description: 'Sent the query text directly; no persisted-query hash.',
        };
  }
  if (request.query) {
    return {
      key: 'resolved',
      label: 'Resolved',
      description: request.capturedPassive
        ? 'Hash resolved from the local registry. The request was not modified.'
        : 'Hash swapped; Apollo retried with the full query.',
    };
  }
  if (request.capturedPassive) {
    return {
      key: 'unknown',
      label: 'Not in registry',
      description:
        'Passive mode has not seen this hash yet. Capture it once with passive mode off and it will resolve from then on.',
    };
  }
  return {
    key: 'pending',
    label: 'Awaiting retry',
    description:
      'Hash swapped; waiting for Apollo to retry with the full query. If nothing arrives, the server may not answer PersistedQueryNotFound.',
  };
}

/**
 * First characters of a SHA-256 hash, enough to tell rows apart.
 * @param {string} hash
 * @returns {string}
 */
export function shortHash(hash) {
  return hash ? hash.slice(0, 8) : '';
}
