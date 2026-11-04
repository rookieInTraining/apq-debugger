/**
 * Opt-in usage analytics in the panel: the one-time consent notice, the
 * settings toggle, and the fire-and-forget event helper. The service worker
 * owns consent storage and enforcement; this module only reflects its state.
 * @module ui/analytics-consent
 */

import { getElement } from './dom-helpers.js';

/** Last known analytics state reported by the service worker. */
const analytics = { configured: false, consent: null };

/**
 * Send an allowlisted analytics event. Fire-and-forget: does nothing unless
 * analytics is configured and consent is granted (the service worker still
 * enforces both), and never surfaces errors.
 * @param {string} name - Allowlisted event name.
 * @param {Record<string, string>} [params] - Enum-valued event parameters.
 */
export function track(name, params) {
  if (!analytics.configured || analytics.consent !== 'granted') return;
  try {
    chrome.runtime.sendMessage({ trackEvent: { name, params } }, () => {
      void chrome.runtime.lastError; // panel/SW may be gone; ignore
    });
  } catch (_) {
    /* extension context invalidated */
  }
}

/** Reflect the current state in the notice, settings row and checkbox. */
function render() {
  const notice = getElement('analytics-notice');
  const setting = getElement('analytics-setting');
  const toggle = getElement('analytics-toggle');

  if (notice) {
    notice.classList.toggle('hidden', !(analytics.configured && analytics.consent === null));
  }
  if (setting) setting.classList.toggle('hidden', !analytics.configured);
  if (toggle) toggle.checked = analytics.consent === 'granted';
}

/**
 * Apply a state reported by the service worker.
 * @param {{configured?: boolean, consent?: string|null}} next
 */
function applyState(next) {
  if (next.configured !== undefined) analytics.configured = next.configured === true;
  if (next.consent !== undefined) {
    analytics.consent =
      next.consent === 'granted' || next.consent === 'denied' ? next.consent : null;
  }
  render();
}

/**
 * Handle the `ANALYTICS_UPDATED` broadcast (consent changed in another panel).
 * @param {{consent?: string|null}} message
 */
export function handleAnalyticsUpdated(message) {
  if (!message) return;
  applyState({ consent: message.consent });
}

/**
 * Store a consent choice via the service worker. The UI updates optimistically
 * so the notice never lingers, then settles on the worker's answer.
 * @param {'granted'|'denied'} value
 */
function setConsent(value) {
  applyState({ consent: value });
  chrome.runtime.sendMessage({ setAnalyticsConsent: value }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.status === 'SUCCESS') {
      applyState({ configured: response.configured, consent: response.consent });
    }
  });
}

/**
 * Wire the notice buttons and settings checkbox, load the current state, and
 * report `panel_open` once that state shows consent is granted.
 */
export function initAnalyticsConsent() {
  const allow = getElement('analytics-allow');
  const decline = getElement('analytics-decline');
  const dismiss = getElement('analytics-dismiss');
  const toggle = getElement('analytics-toggle');

  if (allow) allow.addEventListener('click', () => setConsent('granted'));
  if (decline) decline.addEventListener('click', () => setConsent('denied'));
  if (dismiss) dismiss.addEventListener('click', () => setConsent('denied'));
  if (toggle) {
    toggle.addEventListener('change', () => setConsent(toggle.checked ? 'granted' : 'denied'));
  }

  chrome.runtime.sendMessage({ getAnalyticsState: true }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.status === 'SUCCESS') {
      applyState({ configured: response.configured, consent: response.consent });
      // Only now is consent known, so panel_open can pass the track() gate
      track('panel_open');
    }
  });
}
