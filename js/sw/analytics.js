/**
 * Opt-in usage analytics via the GA4 Measurement Protocol.
 *
 * Nothing is sent unless the build was configured (GA_MEASUREMENT_ID and
 * GA_API_SECRET at build time) and the user granted consent. Every event goes
 * through the allowlist in shared/analytics-events.js, so only allowlisted
 * event names with enum-valued params can leave the browser. Failures are
 * swallowed: no retries, no queue, no user-visible errors.
 * @module sw/analytics
 */

import { sanitizeEvent } from '../shared/analytics-events.js';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  ANALYTICS_CLIENT_ID_STORAGE_KEY,
  ANALYTICS_SESSION_STORAGE_KEY,
  GA_ENDPOINT,
} from '../shared/constants.js';
import {
  storageGet,
  storageSet,
  storageRemove,
  sessionGet,
  sessionSet,
  sessionRemove,
  getPlatformInfo,
} from './chrome-api.js';

/** GA4 needs a non-zero engagement time for events to count as engaged. */
const ENGAGEMENT_TIME_MSEC = 100;

/* global __GA_MEASUREMENT_ID__, __GA_API_SECRET__ */

/**
 * Build-time config, injected by esbuild `define`; absent in tests unless set on global.
 * Read on every call so tests can switch it.
 * @returns {{ measurementId: string, apiSecret: string }}
 */
function getConfig() {
  return {
    measurementId: typeof __GA_MEASUREMENT_ID__ === 'string' ? __GA_MEASUREMENT_ID__ : '',
    apiSecret: typeof __GA_API_SECRET__ === 'string' ? __GA_API_SECRET__ : '',
  };
}

/**
 * Whether this build has analytics credentials. Unconfigured builds never send.
 * @returns {boolean}
 */
export function isAnalyticsConfigured() {
  const { measurementId, apiSecret } = getConfig();
  return measurementId !== '' && apiSecret !== '';
}

/**
 * Read the stored consent.
 * @returns {Promise<'granted'|'denied'|null>} null when the user was never asked.
 */
export async function getConsent() {
  const result = await storageGet(ANALYTICS_CONSENT_STORAGE_KEY);
  const value = result[ANALYTICS_CONSENT_STORAGE_KEY];
  return value === 'granted' || value === 'denied' ? value : null;
}

/** In-flight session-ID creation, shared so concurrent events create one ID. */
let sessionIdPromise = null;
/** Tail of the consent lock: consent changes and the consent check + send of each hit. */
let consentQueue = Promise.resolve();

/**
 * Run a task after every earlier consent change, holding later ones until it ends.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withConsentLock(task) {
  const run = consentQueue.then(task);
  consentQueue = run.catch(() => {});
  return run;
}

/**
 * Read the install ID. Only setConsent('granted') creates it, so a hit that
 * races a withdrawal can never bring it back.
 * @returns {Promise<string|null>}
 */
async function getClientId() {
  const result = await storageGet(ANALYTICS_CLIENT_ID_STORAGE_KEY);
  const existing = result[ANALYTICS_CLIENT_ID_STORAGE_KEY];
  return typeof existing === 'string' && existing ? existing : null;
}

/**
 * Create the install ID unless one exists. Called only while granting consent.
 * @returns {Promise<void>}
 */
async function ensureClientId() {
  if (await getClientId()) return;
  await storageSet({ [ANALYTICS_CLIENT_ID_STORAGE_KEY]: crypto.randomUUID() });
}

/**
 * Get the per-browser-session ID (chrome.storage.session is cleared on browser
 * exit), creating it lazily while consent is granted. Consent is re-checked
 * after the write: withdrawal stores 'denied' before removing the IDs, so a
 * write that lands after the removal is undone here.
 * @returns {Promise<string|null>} null when consent is no longer granted.
 */
function getSessionId() {
  if (!sessionIdPromise) {
    const pending = (async () => {
      const result = await sessionGet(ANALYTICS_SESSION_STORAGE_KEY);
      const existing = result[ANALYTICS_SESSION_STORAGE_KEY];
      if (typeof existing === 'string' && existing) return existing;
      if ((await getConsent()) !== 'granted') return null;
      const id = String(Math.floor(Math.random() * 2 ** 31) + 1);
      await sessionSet({ [ANALYTICS_SESSION_STORAGE_KEY]: id });
      if ((await getConsent()) !== 'granted') {
        await sessionRemove(ANALYTICS_SESSION_STORAGE_KEY);
        return null;
      }
      return id;
    })();
    sessionIdPromise = pending;
    // Dedupe in-flight creation only: storage stays the source of truth
    pending
      .finally(() => {
        if (sessionIdPromise === pending) sessionIdPromise = null;
      })
      .catch(() => {});
  }
  return sessionIdPromise;
}

/**
 * Chrome major version, from UA client hints when available.
 * @returns {string}
 */
function getBrowserMajor() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const brands = nav && nav.userAgentData && nav.userAgentData.brands;
  if (Array.isArray(brands)) {
    const brand = brands.find((b) => b.brand === 'Google Chrome' || b.brand === 'Chromium');
    if (brand && brand.version) return String(brand.version).split('.')[0];
  }
  const match = nav && typeof nav.userAgent === 'string' && nav.userAgent.match(/Chrome\/(\d+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Coarse environment properties attached to every hit.
 * @returns {Promise<object>} GA4 `user_properties`.
 */
async function getUserProperties() {
  let os = 'unknown';
  try {
    os = (await getPlatformInfo()).os || 'unknown';
  } catch (_) {
    // Platform unavailable — report unknown
  }
  let uiLanguage = 'unknown';
  try {
    uiLanguage = chrome.i18n.getUILanguage() || 'unknown';
  } catch (_) {
    // i18n unavailable — report unknown
  }
  return {
    extension_version: { value: chrome.runtime.getManifest().version },
    browser_major: { value: getBrowserMajor() },
    os: { value: os },
    ui_language: { value: uiLanguage },
  };
}

/**
 * Send one allowlisted event. No-op unless configured and consent is granted.
 * Never rejects, so callers can fire and forget.
 * @param {string} name - Event name; dropped unless allowlisted.
 * @param {object} [params] - Enum params; values outside the allowlist are dropped.
 * @returns {Promise<void>}
 */
export async function trackEvent(name, params = {}) {
  try {
    if (!isAnalyticsConfigured()) return;
    const event = sanitizeEvent(name, params);
    if (!event) return;
    if ((await getConsent()) !== 'granted') return;
    if (typeof fetch !== 'function') return;

    const [clientId, sessionId, userProperties] = await Promise.all([
      getClientId(),
      getSessionId(),
      getUserProperties(),
    ]);
    if (!clientId || !sessionId) return;
    const { measurementId, apiSecret } = getConfig();
    const url =
      `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}` +
      `&api_secret=${encodeURIComponent(apiSecret)}`;
    const body = {
      client_id: clientId,
      user_properties: userProperties,
      events: [
        {
          name: event.name,
          params: {
            ...event.params,
            session_id: sessionId,
            engagement_time_msec: ENGAGEMENT_TIME_MSEC,
          },
        },
      ],
    };
    // Re-check consent and start the request under the consent lock, so a
    // withdrawal either lands first (nothing sent) or after the hit left.
    // Only the call is locked, not the network round trip.
    const request = await withConsentLock(async () =>
      (await getConsent()) === 'granted'
        ? {
            pending: fetch(url, {
              method: 'POST',
              body: JSON.stringify(body),
              credentials: 'omit',
            }),
          }
        : null
    );
    if (!request) return;
    const response = await request.pending;
    if (!response || !response.ok) {
      console.debug('Analytics hit rejected:', response && response.status);
    }
  } catch (error) {
    console.debug('Analytics hit failed:', error);
  }
}

/**
 * Record the user's answer. Granting creates the install ID and sends
 * `analytics_opt_in`; denying deletes the install and session IDs.
 * Broadcasts `ANALYTICS_UPDATED` to every panel (no tabId: it is global).
 * Resolves once the answer is stored; the opt-in hit is not awaited, so the
 * reply never waits for the network.
 * @param {'granted'|'denied'} value
 * @returns {Promise<void>}
 */
export async function setConsent(value) {
  await withConsentLock(() => applyConsent(value));
  if (value === 'granted') {
    trackEvent('analytics_opt_in').catch((error) => {
      console.debug('Analytics opt-in hit failed:', error);
    });
  }
}

/**
 * Store consent and create or delete the IDs (runs serialized via setConsent).
 * @param {'granted'|'denied'} value
 * @returns {Promise<void>}
 */
async function applyConsent(value) {
  // Consent is written first: in-flight hits re-check it before sending
  await storageSet({ [ANALYTICS_CONSENT_STORAGE_KEY]: value });

  if (value === 'granted') {
    if (isAnalyticsConfigured()) await ensureClientId();
  } else {
    sessionIdPromise = null;
    await storageRemove(ANALYTICS_CLIENT_ID_STORAGE_KEY);
    await sessionRemove(ANALYTICS_SESSION_STORAGE_KEY);
  }

  chrome.runtime.sendMessage({ status: 'ANALYTICS_UPDATED', consent: value }, () => {
    if (chrome.runtime.lastError) {
      // No panel open — that's fine
    }
  });
}
