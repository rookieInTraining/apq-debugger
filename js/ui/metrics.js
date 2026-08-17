/**
 * Session metrics: captured requests, resolved hashes, unique operations
 * and unique endpoints, all derived from request history. The toolbar
 * shows captured and resolved; the other counts render when their
 * elements exist.
 * @module ui/metrics
 */

import { state } from './state.js';
import { endpointKey } from './endpoint-utils.js';

function setMetric(id, value) {
  // Optional: the toolbar shows only captured and resolved counts, so the
  // other metrics render only where an element exists (no error when absent).
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

/**
 * Recompute and render the four metric tiles from state.requestHistory.
 * Called from renderRequestList so every history change updates the strip.
 */
export function renderMetrics() {
  const history = state.requestHistory;

  const operations = new Set();
  const endpoints = new Set();
  let resolved = 0;

  for (const request of history) {
    if (request.type === 'apq' && request.query) resolved++;
    if (request.operationName) operations.add(request.operationName);
    const key = endpointKey(request.url);
    if (key) endpoints.add(key);
  }

  setMetric('metric-captured', history.length);
  setMetric('metric-resolved', resolved);
  setMetric('metric-operations', operations.size);
  setMetric('metric-endpoints', endpoints.size);
}
