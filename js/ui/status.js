/**
 * Session status indicator and toast notifications for the DevTools panel.
 * showStatusBanner / hideStatusBanner render toasts into the
 * #status-banner stack.
 * @module ui/status
 */

import { getElement } from './dom-helpers.js';

/** Maximum toasts kept on screen; oldest are dropped first. */
const TOAST_LIMIT = 4;

/** Auto-dismiss delay for transient toasts. */
const TOAST_DISMISS_MS = 5000;

const CLOSE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/></svg>';

/**
 * Update the session status indicator in the tab strip.
 * @param {string} text - Status word (Off, Starting, Intercepting, Passive, Stopping, Error…).
 * @param {'default'|'active'|'success'|'info'|'warning'|'error'} type
 */
export function updateDebuggerStatus(text, type = 'default') {
  const statusBadge = getElement('debugger-status');
  if (!statusBadge) return;

  const statusText = statusBadge.querySelector('.status-text');
  if (statusText) statusText.textContent = text;

  statusBadge.className = 'status';
  if (type === 'active' || type === 'success') {
    statusBadge.classList.add('active');
  } else if (type === 'info') {
    statusBadge.classList.add('info');
  } else if (type === 'warning') {
    statusBadge.classList.add('warning');
  } else if (type === 'error') {
    statusBadge.classList.add('error');
  }
}

/**
 * Remove one toast and hide the stack container when it empties.
 * @param {HTMLElement} toast
 */
function removeToast(toast) {
  toast.remove();
  const stack = getElement('status-banner');
  if (stack && stack.childElementCount === 0) {
    stack.classList.add('hidden');
  }
}

/**
 * Show a toast in the bottom-right stack. Success/warning/default toasts
 * dismiss themselves; error toasts persist until dismissed.
 * @param {string} message
 * @param {'default'|'success'|'warning'|'error'} type
 * @param {boolean} autoDismiss - Kept for API compatibility; transient
 *   types dismiss regardless.
 */
export function showStatusBanner(message, type = 'default', autoDismiss = false) {
  const stack = getElement('status-banner');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'warning') toast.classList.add('toast--warning');
  else if (type === 'error') toast.classList.add('toast--error');
  else if (type === 'success') toast.classList.add('toast--success');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (type === 'error') {
    toast.setAttribute('role', 'alert');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'icon-btn toast-close';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.innerHTML = CLOSE_ICON;
    dismiss.addEventListener('click', () => removeToast(toast));
    toast.appendChild(dismiss);
  }

  stack.appendChild(toast);
  stack.classList.remove('hidden');

  while (stack.childElementCount > TOAST_LIMIT) {
    stack.firstElementChild.remove();
  }

  if (autoDismiss || type !== 'error') {
    setTimeout(() => removeToast(toast), TOAST_DISMISS_MS);
  }
}

/**
 * Clear all toasts and hide the stack.
 */
export function hideStatusBanner() {
  const stack = getElement('status-banner');
  if (!stack) return;
  stack.textContent = '';
  stack.classList.add('hidden');
}

/**
 * Display an error in both the status indicator and a persistent toast.
 * @param {string} message
 */
export function showError(message) {
  console.error(message);
  updateDebuggerStatus('Error', 'error');
  showStatusBanner(message, 'error');
}
