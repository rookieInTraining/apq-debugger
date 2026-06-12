/**
 * Fetch.requestPaused handler and APQ payload contamination logic.
 * @module sw/interceptor
 */

import { digestMessage } from './hash.js';
import { isPassiveMode, lookupHash, registerHash } from './hash-registry.js';
import { recordEndpoint } from './endpoint-tracker.js';
import { BOGUS_HASH_SEED, BASE64_CHUNK_SIZE, DEFAULT_OPERATION_NAME } from '../shared/constants.js';

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
 * @returns {Promise<boolean>} True if the payload was modified.
 */
export async function contaminatePayload(payload, requestUrl, tabId) {
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
 * Convert a Uint8Array to a base64 string using chunked encoding
 * to avoid stack overflow on large payloads.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
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
 * Handle a Fetch.requestPaused debugger event.
 * Parses the request body, contaminates APQ payloads, and continues the request.
 * The request body is only rewritten when a payload was actually modified.
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
      let modified = false;

      // Remember GraphQL endpoints to speed up schema auto-detection
      if (looksLikeGraphQL(reqBody)) {
        recordEndpoint(source.tabId, requestUrl);
      }

      if (Array.isArray(reqBody)) {
        console.log('Request payload is an array');
        for (const req of reqBody) {
          modified = (await contaminatePayload(req, requestUrl, source.tabId)) || modified;
        }
      } else {
        console.log('Request payload is a JSON element');
        modified = await contaminatePayload(reqBody, requestUrl, source.tabId);
      }

      if (!modified) {
        // Nothing was changed (full query, passive mode, or unrecognized payload)
        // — continue with the original body untouched
        continueRequest(source.tabId, params.requestId);
        return;
      }

      // Encode the modified request as base64 (chunked to avoid overflow)
      const modifiedJson = JSON.stringify(reqBody);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(modifiedJson);
      const base64Data = uint8ArrayToBase64(bytes);

      console.info(`Modified Request: ${modifiedJson}\nBase64: ${base64Data}`);
      console.info('Executing Fetch.continueRequest...');

      continueRequest(source.tabId, params.requestId, base64Data);
    } catch (processingError) {
      console.error('Error processing request:', processingError);
      continueRequest(source.tabId, params.requestId);
    }
  })();
}
