/**
 * Fetch.requestPaused handler and APQ payload contamination logic.
 * @module sw/interceptor
 */

import { digestMessage } from './hash.js';
import { encodeBase64Json, buildContinueParams } from './resume-body.js';
import { isPassiveMode, lookupHash, registerHash } from './hash-registry.js';
import { recordEndpoint } from './endpoint-tracker.js';
import { isPanelConnected } from './panel-presence.js';
import { initBreakpoints, getDebugState, decidePause, consumePauseNext } from './breakpoints.js';
import { holdRequest, getHeld, continueHeld } from './pause-queue.js';
import { trackEvent } from './analytics.js';
import { extractOperationName } from '../shared/operation-name.js';
import { BOGUS_HASH_SEED, DEFAULT_OPERATION_NAME } from '../shared/constants.js';

/**
 * Check whether a parsed request body looks like a GraphQL operation.
 * @param {*} body
 * @returns {boolean}
 */
function looksLikeGraphQL(body) {
  if (Array.isArray(body)) return body.some(looksLikeGraphQL);
  if (!body || typeof body !== 'object') return false;
  return body.query !== undefined || !!(body.extensions && body.extensions.persistedQuery);
}

/** Headers set explicitly by the curl generators or derived from the URL. */
const CURL_SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
  'content-type',
  'accept',
]);

/**
 * Normalize CDP Fetch request headers for replay in curl/PowerShell.
 * @param {object|undefined} headers - CDP headers dictionary (name -> value).
 * @returns {{name: string, value: string}[]}
 */
export function normalizeRequestHeaders(headers) {
  if (!headers || typeof headers !== 'object') return [];

  const result = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!name || value === undefined || value === null) continue;
    if (CURL_SKIP_HEADERS.has(name.toLowerCase())) continue;
    result.push({ name, value: String(value) });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** Cached bogus hash to avoid recomputing SHA-256 on every APQ request. */
let cachedBogusHash = null;

/**
 * Get (or compute once) the bogus hash used to contaminate APQ requests.
 * @returns {Promise<string|null>}
 */
async function getBogusHash() {
  if (!cachedBogusHash) {
    cachedBogusHash = await digestMessage(BOGUS_HASH_SEED);
  }
  return cachedBogusHash;
}

/**
 * Send an INTERCEPTED message to the DevTools panel.
 * Silently ignores the (common) case where no panel is listening.
 * @param {object} fields - Message fields merged over the defaults.
 */
function sendIntercepted(fields) {
  chrome.runtime.sendMessage(
    {
      status: 'INTERCEPTED',
      operationName: DEFAULT_OPERATION_NAME,
      url: '',
      query: '',
      variables: null,
      hash: '',
      isAPQ: false,
      ...fields,
    },
    () => {
      if (chrome.runtime.lastError) {
        // DevTools panel for this tab might not be open — that's fine
      }
    }
  );
}

/**
 * Contaminate an APQ payload by replacing the persisted-query hash,
 * or capture a full-query payload and forward it to the DevTools panel.
 * In passive mode, APQ hashes are resolved from the registry instead of
 * being contaminated, leaving the request untouched.
 * @param {object} payload - Parsed request body (single GraphQL operation).
 * @param {string} requestUrl - The original request URL.
 * @param {number} tabId - The source tab ID.
 * @param {{name: string, value: string}[]} [requestHeaders] - Captured HTTP headers.
 * @returns {Promise<boolean>} True if the payload was modified.
 */
export async function contaminatePayload(payload, requestUrl, tabId, requestHeaders = []) {
  try {
    if (!payload || typeof payload !== 'object') {
      console.log('Invalid payload format:', payload);
      return false;
    }

    if (payload.query === undefined && payload.extensions && payload.extensions.persistedQuery) {
      const originalHash = payload.extensions.persistedQuery.sha256Hash || '';

      if (isPassiveMode()) {
        // Passive mode — resolve the hash from the registry, leave the request untouched
        const entry = lookupHash(originalHash);
        console.info(
          entry ? 'Resolved APQ hash from registry' : 'APQ hash not in registry (passive mode)'
        );

        sendIntercepted({
          operationName: payload.operationName || entry?.operationName || DEFAULT_OPERATION_NAME,
          url: requestUrl || '',
          query: entry?.query || '',
          variables: payload.variables || entry?.variables || null,
          hash: originalHash,
          isAPQ: true,
          tabId,
          headers: requestHeaders,
        });
        return false;
      }

      // Active mode — contaminate the hash to force the full-query retry
      const hash = await getBogusHash();
      if (hash) {
        payload.extensions.persistedQuery.sha256Hash = hash;
        console.info('Contaminated APQ request hash');

        sendIntercepted({
          operationName: payload.operationName || DEFAULT_OPERATION_NAME,
          url: requestUrl || '',
          variables: payload.variables || null,
          hash: originalHash,
          isAPQ: true,
          tabId,
          headers: requestHeaders,
        });
        return true;
      }

      console.error('Failed to generate hash for payload');
      return false;
    } else if (payload.query !== undefined) {
      // Full query request — capture, register its hash, and send to DevTools
      console.log('Captured full query request:', payload.operationName);

      const requestHash = payload.extensions?.persistedQuery?.sha256Hash || '';
      if (requestHash) {
        registerHash(requestHash, {
          query: payload.query || '',
          operationName: payload.operationName || '',
          variables: payload.variables || null,
        });
      }

      sendIntercepted({
        operationName: payload.operationName || DEFAULT_OPERATION_NAME,
        url: requestUrl || '',
        query: payload.query || '',
        variables: payload.variables || null,
        hash: requestHash,
        isAPQ: false,
        tabId,
        headers: requestHeaders,
      });
      return false;
    } else {
      try {
        console.log('Payload does not contain query or APQ extensions:', JSON.stringify(payload));
      } catch (stringifyError) {
        console.log('Payload does not contain query or APQ extensions (could not stringify)');
      }
      return false;
    }
  } catch (error) {
    console.error('Error in contaminatePayload:', error);
    return false;
  }
}

/**
 * Send Fetch.continueRequest and handle any lastError.
 * @param {number} tabId
 * @param {string} requestId
 * @param {string} [postData] - Optional base64-encoded post data.
 */
function continueRequest(tabId, requestId, postData) {
  const params = postData ? { requestId, postData } : { requestId };

  chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', params, () => {
    if (chrome.runtime.lastError) {
      console.error('Fetch.continueRequest failed:', chrome.runtime.lastError);
    }
  });
}

/**
 * Record each operation's hash and shape before contamination rewrites hashes.
 * @param {object|object[]} body - Parsed request body.
 * @returns {{hash: string, isHashOnly: boolean}[]}
 */
function snapshotOperations(body) {
  return (Array.isArray(body) ? body : [body]).map((op) => {
    const pq = op && typeof op === 'object' && op.extensions && op.extensions.persistedQuery;
    return {
      hash: (pq && typeof pq.sha256Hash === 'string' && pq.sha256Hash) || '',
      isHashOnly: !!pq && op.query === undefined,
    };
  });
}

/**
 * Describe one operation of a held request for the panel.
 * @param {*} op - Operation payload (possibly contaminated).
 * @param {number} index - Position in the batch (0 for a single operation).
 * @param {{hash: string, isHashOnly: boolean}} original - Pre-contamination snapshot.
 * @returns {import('./pause-queue.js').HeldOperation}
 */
function describeOperation(op, index, original) {
  const payload = op && typeof op === 'object' ? op : {};
  const entry = original.hash ? lookupHash(original.hash) : null;
  const hasQuery = typeof payload.query === 'string';
  const registryQuery = !hasQuery && entry && entry.query ? entry.query : '';
  return {
    index,
    operationName: extractOperationName(payload, entry),
    query: hasQuery ? payload.query : registryQuery,
    querySource: hasQuery ? 'request' : registryQuery ? 'registry' : 'none',
    variables: payload.variables !== undefined ? payload.variables : null,
    hash: original.hash,
    isHashOnly: original.isHashOnly,
  };
}

/**
 * Hold the request in the pause queue if debug mode or pause-next asks for it.
 * Only called while a panel for the tab is connected. Any failure resolves to
 * false so the caller falls back to the normal continue path.
 * @param {number} tabId
 * @param {object} params - Fetch.requestPaused event params.
 * @param {object|object[]} body - Parsed (possibly contaminated) request body.
 * @param {{hash: string, isHashOnly: boolean}[]} originals - Pre-contamination snapshot.
 * @param {boolean} bodyModified - Whether `body` was rewritten (contaminated).
 * @returns {Promise<boolean>} True if the request was taken over by the pause
 *   queue (do not continue it here).
 */
async function holdIfPaused(tabId, params, body, originals, bodyModified) {
  try {
    await initBreakpoints();
    const { debugMode, pauseNext } = getDebugState(tabId);
    if (!debugMode && !pauseNext) return false;

    const ctx = { tabId, passive: isPassiveMode() };
    const ops = Array.isArray(body) ? body : [body];
    const operations = ops.map((op, index) => describeOperation(op, index, originals[index]));

    let reason = null;
    for (const op of operations) {
      const decision = decidePause(
        { operationName: op.operationName, isHashOnly: op.isHashOnly },
        ctx
      );
      if (decision === 'pause-next') {
        reason = decision;
        break;
      }
      if (decision) reason = decision;
    }
    if (!reason) return false;

    if (reason === 'pause-next') {
      // The in-memory flag clears synchronously, so a concurrent request
      // cannot also be taken as "the next one".
      consumePauseNext(tabId).catch((error) => {
        console.warn('Failed to persist pause-next:', error);
      });
    }

    const held = await holdRequest({
      id: params.requestId,
      networkId: params.networkId || '',
      tabId,
      url: params.request.url || '',
      method: params.request.method || 'POST',
      heldAt: Date.now(),
      reason,
      state: 'paused',
      body,
      rawHeaders: params.request.headers || {},
      operations,
      bodyModified,
    });
    if (!held) return false;
    trackEvent('breakpoint_hit', {
      reason: reason === 'pause-next' ? 'pause_next' : 'breakpoint',
      mode: ctx.passive ? 'passive' : 'active',
    });

    // The panel may have gone while we were deciding; its disconnect already
    // released the (then empty) queue, so release this request ourselves.
    if (!isPanelConnected(tabId)) {
      const item = getHeld(tabId, params.requestId);
      if (item) await continueHeld(tabId, item.id, await buildContinueParams(item));
    }
    return true;
  } catch (error) {
    console.error('Breakpoint check failed:', error);
    return false;
  }
}

/**
 * Handle a Fetch.requestPaused debugger event.
 * Parses the request body, contaminates APQ payloads, and continues the request.
 * The request body is only rewritten when a payload was actually modified.
 * While a panel for the tab is connected and debug mode or pause-next is on,
 * a matching request is held in the pause queue instead of being continued.
 * @param {{tabId: number}} source
 * @param {object} params - Fetch.requestPaused event params.
 */
export function handleFetchRequestPaused(source, params) {
  (async () => {
    if (!params.request || !params.request.hasPostData) {
      continueRequest(source.tabId, params.requestId);
      return;
    }

    let reqBody;
    try {
      reqBody = JSON.parse(params.request.postData);
    } catch (parseError) {
      console.error('Failed to parse request data:', parseError);
      continueRequest(source.tabId, params.requestId);
      return;
    }

    console.info('Parsed request body:', reqBody);

    try {
      const requestUrl = params.request.url || '';
      const requestHeaders = normalizeRequestHeaders(params.request.headers);
      let modified = false;
      const isGraphQL = looksLikeGraphQL(reqBody);

      // Breakpoints only apply while a panel for this tab is connected
      const originals =
        isGraphQL && isPanelConnected(source.tabId) ? snapshotOperations(reqBody) : null;

      // Remember GraphQL endpoints (with their headers) for schema loading
      if (isGraphQL) {
        recordEndpoint(source.tabId, requestUrl, requestHeaders);
      }

      if (Array.isArray(reqBody)) {
        console.log('Request payload is an array');
        for (const req of reqBody) {
          modified =
            (await contaminatePayload(req, requestUrl, source.tabId, requestHeaders)) || modified;
        }
      } else {
        console.log('Request payload is a JSON element');
        modified = await contaminatePayload(reqBody, requestUrl, source.tabId, requestHeaders);
      }

      if (originals && (await holdIfPaused(source.tabId, params, reqBody, originals, modified))) {
        // Held: the panel resumes or fails it later
        return;
      }

      if (!modified) {
        // Nothing was changed (full query, passive mode, or unrecognized payload)
        // — continue with the original body untouched
        continueRequest(source.tabId, params.requestId);
        return;
      }

      // Encode the modified request as base64 (chunked to avoid overflow)
      const modifiedJson = JSON.stringify(reqBody);
      const base64Data = encodeBase64Json(reqBody);

      console.info(`Modified Request: ${modifiedJson}\nBase64: ${base64Data}`);
      console.info('Executing Fetch.continueRequest...');

      continueRequest(source.tabId, params.requestId, base64Data);
    } catch (processingError) {
      console.error('Error processing request:', processingError);
      continueRequest(source.tabId, params.requestId);
    }
  })();
}
