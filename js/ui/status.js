/**
 * Status badge and banner management for the DevTools panel.
 * @module ui/status
 */

import { getElement } from './dom-helpers.js';
import { state } from './state.js';

/**
 * Update the status badge in the header bar.
 * @param {string} text - Status text to display.
 * @param {'default'|'active'|'success'|'warning'|'error'} type
 */
export function updateDebuggerStatus(text, type = 'default') {
  const statusBadge = getElement('debugger-status');
  if (!statusBadge) return;

  const statusText = statusBadge.querySelector('.status-text');
  if (statusText) statusText.textContent = text;

  statusBadge.className = 'status-badge';
  if (type === 'active' || type === 'success') {
    statusBadge.classList.add('active');
  } else if (type === 'warning') {
    statusBadge.classList.add('warning');
  } else if (type === 'error') {
    statusBadge.classList.add('error');
  }
}

/**
 * Show the status banner below the action buttons.
 * @param {string} message
 * @param {'default'|'success'|'warning'|'error'} type
 * @param {boolean} autoDismiss
 */
export function showStatusBanner(message, type = 'default', autoDismiss = false) {
  const banner = getElement('status-banner');
  const bannerText = getElement('status-banner-text');

  if (!banner || !bannerText) return;

  if (state.statusBannerTimeout) {
    clearTimeout(state.statusBannerTimeout);
    state.statusBannerTimeout = null;
  }

  bannerText.textContent = message;
  banner.className = 'status-banner';
  if (type !== 'default') {
    banner.classList.add(type);
  }
  banner.classList.remove('hidden');

  if (autoDismiss || type === 'success') {
    state.statusBannerTimeout = setTimeout(() => {
      banner.classList.add('hidden');
    }, 5000);
  }
}

/**
 * Hide the status banner.
 */
export function hideStatusBanner() {
  const banner = getElement('status-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
  if (state.statusBannerTimeout) {
    clearTimeout(state.statusBannerTimeout);
    state.statusBannerTimeout = null;
  }
}

/**
 * Display an error in both the status badge and banner.
 * @param {string} message
 */
export function showError(message) {
  console.error(message);
  updateDebuggerStatus("Error", "error");
  showStatusBanner(message, 'error');
}
