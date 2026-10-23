/**
 * Confirm dialog for destructive actions (clear history, clear registry).
 * When the #confirm-dialog element is absent (unit-test fixtures), actions
 * proceed as if confirmed so existing flows stay synchronous.
 * @module ui/confirm
 */

import { getElement } from './dom-helpers.js';

/** @type {((confirmed: boolean) => void)|null} */
let activeResolve = null;

/** @type {HTMLElement|null} */
let previousFocus = null;

function closeDialog(confirmed) {
  const dialog = getElement('confirm-dialog');
  if (dialog) dialog.classList.add('hidden');
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
  }
  previousFocus = null;
  if (activeResolve) {
    const resolve = activeResolve;
    activeResolve = null;
    resolve(confirmed);
  }
}

/**
 * Ask the user to confirm a destructive action.
 * @param {{title: string, body: string, confirmLabel?: string}} options
 * @returns {true|Promise<boolean>} `true` synchronously when no dialog
 *   exists in the DOM; otherwise a promise resolving with the choice.
 */
export function confirmAction({ title, body, confirmLabel = 'Confirm' }) {
  const dialog = getElement('confirm-dialog');
  if (!dialog) return true;

  const titleEl = getElement('confirm-title');
  const bodyEl = getElement('confirm-body');
  const acceptBtn = getElement('confirm-accept');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (acceptBtn) acceptBtn.textContent = confirmLabel;

  previousFocus = document.activeElement;
  dialog.classList.remove('hidden');
  if (acceptBtn) acceptBtn.focus();

  return new Promise((resolve) => {
    activeResolve = resolve;
  });
}

/**
 * Run an action behind a confirmation. Keeps the no-dialog path synchronous.
 * @param {true|Promise<boolean>} result - Return value of confirmAction().
 * @param {() => void} action
 */
export function whenConfirmed(result, action) {
  if (result === true) {
    action();
    return;
  }
  result.then((confirmed) => {
    if (confirmed) action();
  });
}

/**
 * Wire the dialog's buttons, backdrop, and Escape handling.
 */
export function initConfirm() {
  const dialog = getElement('confirm-dialog');
  if (!dialog) return;

  const acceptBtn = getElement('confirm-accept');
  if (acceptBtn) acceptBtn.addEventListener('click', () => closeDialog(true));

  const cancelBtn = getElement('confirm-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeDialog(false));

  const backdrop = dialog.querySelector('.modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => closeDialog(false));

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(false);
    }
  });
}
