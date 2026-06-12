/**
 * Minimal logging utility used by both service-worker and UI bundles.
 * `info` and `debug` calls are stripped in production builds via the
 * esbuild `pure` config in build-enhanced.js (line 78).
 * @module shared/logger
 */

export const log = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
