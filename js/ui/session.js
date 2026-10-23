/**
 * Session controls: the patterns pane toggle and its summary, the
 * infobar that says whether traffic is being rewritten (or resolved
 * passively), and the one-time note explaining what Start does.
 * @module ui/session
 */

import { getPatternsFromForm } from './dom-helpers.js';
import { state } from './state.js';
import { FIRST_RUN_NOTE_STORAGE_KEY } from '../shared/constants.js';

/** Set once the user opens or closes the pane; blocks programmatic defaults. */
let userToggledPane = false;

/** Whether the first-run note has been dismissed (assume yes until storage answers). */
let noteSeen = true;

/**
 * Open or close the patterns pane.
 * @param {boolean} open
 * @param {{user?: boolean}} [options] - `user: true` for a user action;
 *   programmatic calls are ignored once the user has chosen.
 */
export function setPatternsPaneOpen(open, { user = false } = {}) {
  if (user) userToggledPane = true;
  else if (userToggledPane) return;

  const pane = document.getElementById('patterns-pane');
  const toggle = document.getElementById('btn-toggle-patterns');
  if (!pane || !toggle) return;

  pane.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

/**
 * Show the configured patterns in the toolbar toggle ("*graphql* +1").
 */
export function renderPatternsSummary() {
  const summary = document.getElementById('patterns-summary');
  const toggle = document.getElementById('btn-toggle-patterns');
  if (!summary) return;

  const patterns = getPatternsFromForm();
  summary.textContent = patterns.length
    ? patterns[0] + (patterns.length > 1 ? ` +${patterns.length - 1}` : '')
    : 'none';
  if (toggle) toggle.classList.toggle('is-empty', patterns.length === 0);
}

function setText(el, parts) {
  el.textContent = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      el.append(part);
    } else {
      const code = document.createElement('code');
      code.textContent = part.code;
      el.append(code);
    }
  }
}

/**
 * Render the infobar for the current session state: live interception
 * (yellow, with Stop), passive mode (blue), or nothing.
 */
export function renderSessionBar() {
  const bar = document.getElementById('live-bar');
  const text = document.getElementById('live-text');
  const note = document.getElementById('live-note');
  const dismiss = document.getElementById('live-note-dismiss');
  const stop = document.getElementById('live-stop');
  if (!bar || !text) return;

  bar.classList.remove('is-live', 'is-passive');

  if (state.isDebuggerActive) {
    const patterns = getPatternsFromForm();
    const parts = ['Intercepting requests matching '];
    patterns.forEach((pattern, index) => {
      if (index > 0) parts.push(', ');
      parts.push({ code: pattern });
    });
    if (patterns.length === 0) parts.push('the saved patterns');
    setText(text, parts);

    bar.classList.add('is-live');
    bar.classList.remove('hidden');
    if (note) note.classList.toggle('hidden', noteSeen);
    if (dismiss) dismiss.classList.toggle('hidden', noteSeen);
    if (stop) stop.classList.remove('hidden');
    return;
  }

  if (state.passiveMode) {
    const known = state.registrySize || 0;
    setText(text, [
      `Passive mode: resolving hashes from the registry (${known} known). Requests are not modified.`,
    ]);
    bar.classList.add('is-passive');
    bar.classList.remove('hidden');
    if (note) note.classList.add('hidden');
    if (dismiss) dismiss.classList.add('hidden');
    if (stop) stop.classList.add('hidden');
    return;
  }

  bar.classList.add('hidden');
}

/**
 * Wire the patterns toggle, the infobar buttons, and load the
 * first-run note state.
 */
export function initSession() {
  const toggle = document.getElementById('btn-toggle-patterns');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const pane = document.getElementById('patterns-pane');
      const open = pane ? pane.hidden : false;
      setPatternsPaneOpen(open, { user: true });
      if (open) {
        const firstInput = document.querySelector('#patterns-pane .urlPattern');
        if (firstInput) firstInput.focus();
      }
    });
  }

  const form = document.getElementById('myForm');
  if (form) form.addEventListener('input', renderPatternsSummary);

  const stop = document.getElementById('live-stop');
  if (stop) {
    stop.addEventListener('click', () => {
      const recordButton = document.getElementById('form-submit');
      if (recordButton && state.isDebuggerActive) recordButton.click();
    });
  }

  const dismiss = document.getElementById('live-note-dismiss');
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      noteSeen = true;
      renderSessionBar();
      chrome.storage.local.set({ [FIRST_RUN_NOTE_STORAGE_KEY]: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to save first-run note state:', chrome.runtime.lastError);
        }
      });
    });
  }

  chrome.storage.local.get([FIRST_RUN_NOTE_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) return;
    noteSeen = Boolean(result && result[FIRST_RUN_NOTE_STORAGE_KEY]);
    renderSessionBar();
  });

  renderPatternsSummary();
  renderSessionBar();
}
