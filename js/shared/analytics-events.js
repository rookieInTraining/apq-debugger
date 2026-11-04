/**
 * Allowlist gate for analytics events. Every event and parameter value sent
 * to analytics must pass through sanitizeEvent(); anything not listed here is
 * dropped. Values are enum-only so no traffic, page, or user data can leak.
 * @module shared/analytics-events
 */

/**
 * Recursively freezes an object graph so the allowlist cannot be mutated at runtime.
 * @param {object} obj - Object to freeze in place.
 * @returns {object} The same object, frozen.
 */
function deepFreeze(obj) {
  Object.values(obj).forEach((value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });
  return Object.freeze(obj);
}

/**
 * Event name -> parameter name -> allowed string values.
 * Events with no parameters map to an empty object.
 */
export const ANALYTICS_EVENTS = deepFreeze({
  panel_open: {},
  interception_start: {
    mode: ['active', 'passive'],
    trigger: ['panel', 'toolbar'],
  },
  interception_stop: {
    trigger: ['panel', 'toolbar', 'chrome'],
  },
  debug_mode_set: {
    on: ['yes', 'no'],
  },
  pause_next_armed: {},
  breakpoint_hit: {
    reason: ['breakpoint', 'pause_next'],
    mode: ['active', 'passive'],
  },
  paused_resume: {
    edited: ['yes', 'no'],
  },
  paused_resume_all: {},
  paused_fail: {},
  schema_load: {
    result: ['success', 'error'],
    source: ['observed', 'guessed', 'manual'],
  },
  copy: {
    what: ['query', 'variables', 'hash', 'curl_bash', 'curl_powershell'],
  },
  export_history: {},
  settings_change: {
    theme: ['system', 'light', 'dark'],
    density: ['comfortable', 'compact'],
  },
  analytics_opt_in: {},
});

/**
 * Validates an analytics event against the allowlist. Unknown events yield null.
 * Unknown parameter keys and values outside their enum are silently dropped;
 * the event itself is still sent with the remaining valid params.
 * @param {string} name - Event name to validate.
 * @param {object} [params] - Candidate parameters (values must be allowlisted strings).
 * @returns {{ name: string, params: Record<string, string> } | null}
 *   The sanitized event, or null when the event name is not allowlisted.
 */
export function sanitizeEvent(name, params = {}) {
  if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name)) {
    return null;
  }
  const allowedParams = ANALYTICS_EVENTS[name];
  const source = params && typeof params === 'object' ? params : {};
  const sanitized = {};
  Object.keys(allowedParams).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    const value = source[key];
    if (typeof value === 'string' && allowedParams[key].includes(value)) {
      sanitized[key] = value;
    }
  });
  return { name, params: sanitized };
}
