/**
 * Fetch.requestPaused handler and APQ payload contamination logic.
 * @module sw/interceptor
 */

import { digestMessage } from './hash.js';

/** Cached bogus hash to avoid recomputing SHA-256('1234567890') on every APQ request. */
let cachedBogusHash = null;

/**
 * Get (or compute once) the bogus hash used to contaminate APQ requests.
 * @returns {Promise<string|null>}
 */
async function getBogusHash() {
  if (!cachedBogusHash) {
    cachedBogusHash = await digestMessage('1234567890');
  }
  return cachedBogusHash;
}

/**
 * Contaminate an APQ payload by replacing the persisted-query hash,
 * or capture a full-query payload and forward it to the DevTools panel.
 * @param {object} payload - Parsed request body (single GraphQL operation).
 * @param {string} requestUrl - The original request URL.
 * @param {number} tabId - The source tab ID.
 */
export async function contaminatePayload(payload, requestUrl, tabId) {
  try {
    if (!payload || typeof payload !== 'object') {
      console.log('Invalid payload format:', payload);
      return;
    }

    if (payload.query === undefined && payload.extensions && payload.extensions.persistedQuery) {
      // APQ request without query — contaminate the hash
      const hash = await getBogusHash();
      if (hash) {
        payload.extensions.persistedQuery.sha256Hash = hash;
        console.info('Contaminated APQ request hash');
      } else {
        console.error('Failed to generate hash for payload');
      }
    } else if (payload.query !== undefined) {
      // Full query request — capture and send to DevTools
      console.log('Captured full query request:', payload.operationName);

      chrome.runtime.sendMessage(
        {
          status: 'INTERCEPTED',
          operationName: payload.operationName || 'Anonymous Query',
          url: requestUrl || '',
          query: payload.query || '',
          variables: payload.variables || null,
          isAPQ: false,
          tabId: tabId,
        },
        () => {
          if (chrome.runtime.lastError) {
            // DevTools panel for this tab might not be open — that's fine
          }
        }
      );
    } else {
      try {
        console.log('Payload does not contain query or APQ extensions:', JSON.stringify(payload));
      } catch (stringifyError) {
        console.log('Payload does not contain query or APQ extensions (could not stringify)');
      }
    }
  } catch (error) {
    console.error('Error in contaminatePayload:', error);
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
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
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

      if (Array.isArray(reqBody)) {
        console.log('Request payload is an array');
        for (const req of reqBody) {
          await contaminatePayload(req, requestUrl, source.tabId);
        }
      } else {
        console.log('Request payload is a JSON element');
        await contaminatePayload(reqBody, requestUrl, source.tabId);
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
