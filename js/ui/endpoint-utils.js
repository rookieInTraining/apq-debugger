/**
 * Endpoint URL normalization shared by the metrics strip, the endpoints
 * drawer section, and request-list filtering/grouping. Matches the service
 * worker's endpoint-tracker normalization (origin + pathname).
 * @module ui/endpoint-utils
 */

/**
 * Normalize a request URL to its endpoint key (origin + pathname).
 * @param {string} url
 * @returns {string} Empty string when the URL cannot be parsed.
 */
export function endpointKey(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch (_) {
    return '';
  }
}
