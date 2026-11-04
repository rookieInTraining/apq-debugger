/**
 * Breakpoints tab: debug-mode and pause-on-next toolbar, the paused-request
 * list and infobar, the operation-name breakpoint list, and the tab-strip
 * `Paused` status. The request editor (#bp-editor) is rendered by
 * js/ui/paused-editor.js on every selection change.
 * @module ui/breakpoints-view
 */

import { state, inspectedTabId, getWaitingPaused } from './state.js';
import { showMainTab, getActiveView, onTabShown } from './tabs.js';
import { updateDebuggerStatus, restoreSessionStatus, showStatusBanner } from './status.js';
import {
  initPausedEditor,
  renderPausedEditor,
  getPendingEdits,
  getEditError,
  showEditError,
  CANCELLED_MESSAGE,
} from './paused-editor.js';

/**
 * One GraphQL operation inside a held request (mirrors `HeldOperation` in
 * js/sw/pause-queue.js).
 * @typedef {object} HeldOperation
 * @property {number} index
 * @property {string} operationName
 * @property {string} query
 * @property {'request'|'registry'|'none'} querySource
 * @property {object|null} variables
 * @property {string} hash
 * @property {boolean} isHashOnly
 */

/**
 * A request held by the service worker (mirrors `HeldRequest` in
 * js/sw/pause-queue.js).
 * @typedef {object} HeldRequest
 * @property {string} id
 * @property {string} networkId
 * @property {number} tabId
 * @property {string} url
 * @property {string} method
 * @property {number} heldAt
 * @property {'breakpoint'|'pause-next'} reason
 * @property {'paused'|'cancelled'} state
 * @property {object|object[]} body
 * @property {boolean} [bodyModified]
 * @property {Record<string,string>} rawHeaders
 * @property {HeldOperation[]} operations
 */

/** @typedef {{name: string, enabled: boolean}} Breakpoint */

const REMOVE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/></svg>';

/** @param {string} id */
const byId = (id) => document.getElementById(id);

/** @type {Array<(held: HeldRequest|null) => void>} */
const selectionListeners = [];

/** Ids already shown, so only newly held requests bring the tab forward. */
let seenIds = new Set();

/**
 * Send a message to the service worker; `onFailure` runs on any error or
 * non-SUCCESS reply.
 * @param {object} message
 * @param {(response: object) => void} [onSuccess]
 * @param {() => void} [onFailure]
 */
function sendToWorker(message, onSuccess, onFailure) {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== 'SUCCESS') {
      if (onFailure) onFailure();
      return;
    }
    if (onSuccess) onSuccess(response);
  });
}

/**
 * Display name of a held request: its operation names, or a stand-in.
 * @param {HeldRequest} held
 * @returns {string}
 */
function heldName(held) {
  const names = (held.operations || []).map((op) => op.operationName).filter(Boolean);
  return names.length ? names.join(', ') : 'anonymous operation';
}

/**
 * The currently selected held request.
 * @returns {HeldRequest|null}
 */
function selectedHeld() {
  return state.paused.find((item) => item.id === state.selectedPausedId) || null;
}

// ── Breakpoint list ───────────────────────────────────────────────

/** @returns {Breakpoint[]} Named rows from the form, trimmed. */
function readBreakpoints() {
  return Array.from(document.querySelectorAll('#bp-list .bp-item'))
    .map((row) => ({
      name: row.querySelector('.bp-name').value.trim(),
      enabled: row.querySelector('.bp-enable').checked,
    }))
    .filter((bp) => bp.name.length > 0);
}

/**
 * @param {Breakpoint[]} a
 * @param {Breakpoint[]} b
 */
function sameBreakpoints(a, b) {
  return (
    a.length === b.length &&
    a.every((bp, i) => bp.name === b[i].name && bp.enabled === b[i].enabled)
  );
}

/** Persist the form's breakpoints through the service worker when they changed. */
function saveBreakpoints() {
  const list = readBreakpoints();
  if (sameBreakpoints(list, state.breakpoints)) return;
  state.breakpoints = list;
  sendToWorker(
    { setBreakpoints: list },
    (response) => {
      if (Array.isArray(response.breakpoints)) state.breakpoints = response.breakpoints;
    },
    () => showStatusBanner('Failed to save breakpoints', 'error')
  );
}

/**
 * @param {HTMLInputElement} toggle
 * @param {string} name
 */
function labelToggle(toggle, name) {
  const trimmed = name.trim();
  toggle.setAttribute('aria-label', trimmed ? `Enable breakpoint ${trimmed}` : 'Enable breakpoint');
}

/**
 * Append one breakpoint row (enable dot, name field, remove button).
 * @param {Breakpoint} [bp]
 * @returns {HTMLInputElement|null} The row's name field.
 */
function addBreakpointRow(bp = { name: '', enabled: true }) {
  const form = byId('bp-list');
  if (!form) return null;

  const row = document.createElement('div');
  row.className = 'bp-item';

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'bp-enable';
  toggle.checked = bp.enabled;
  labelToggle(toggle, bp.name);
  toggle.addEventListener('change', saveBreakpoints);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tb-input bp-name';
  input.setAttribute('aria-label', 'Operation name');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Operation name, e.g. GetCart';
  input.value = bp.name;
  input.addEventListener('input', () => labelToggle(toggle, input.value));
  input.addEventListener('blur', saveBreakpoints);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBreakpoints();
    }
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn bp-remove';
  removeBtn.title = 'Remove breakpoint';
  removeBtn.setAttribute('aria-label', 'Remove breakpoint');
  removeBtn.innerHTML = REMOVE_ICON;
  removeBtn.addEventListener('click', () => {
    row.remove();
    saveBreakpoints();
  });

  row.append(toggle, input, removeBtn);
  form.appendChild(row);
  return input;
}

/**
 * Rebuild the breakpoint rows; an empty list shows one blank row to type into.
 * @param {Breakpoint[]} list
 */
function renderBreakpoints(list) {
  const form = byId('bp-list');
  if (!form) return;
  form.textContent = '';
  if (list.length === 0) addBreakpointRow();
  else list.forEach((bp) => addBreakpointRow(bp));
}

// ── Toolbar ───────────────────────────────────────────────────────

/** Reflect debug mode, pause-on-next and the queue in the toolbar. */
function renderToolbar() {
  const debugToggle = byId('bp-debug-mode');
  if (debugToggle) debugToggle.checked = state.debugMode;

  const pauseNext = byId('bp-pause-next');
  if (pauseNext) pauseNext.setAttribute('aria-pressed', String(state.pauseNext));
  const hint = byId('bp-pause-next-hint');
  if (hint) hint.hidden = !state.pauseNext;

  const resumeAll = byId('bp-resume-all');
  if (resumeAll) resumeAll.disabled = getWaitingPaused().length === 0;
}

/** @param {{debugMode?: boolean, pauseNext?: boolean}} response */
function applyDebugState(response) {
  if (typeof response.debugMode === 'boolean') state.debugMode = response.debugMode;
  if (typeof response.pauseNext === 'boolean') state.pauseNext = response.pauseNext;
  renderToolbar();
}

/**
 * Resume every waiting request for this tab: edited requests first, each
 * with its edits, then the rest unmodified. An edited request with invalid
 * JSON is selected with its error shown and nothing is sent. Both the
 * Resume all button and F8 come through here.
 */
export function resumeAllPaused() {
  const waiting = getWaitingPaused();
  if (waiting.length === 0) return;

  const invalid = waiting.find((item) => getEditError(item.id));
  if (invalid) {
    selectPaused(invalid.id);
    showEditError(invalid.id);
    return;
  }

  const edited = waiting
    .map((item) => ({ id: item.id, edits: getPendingEdits(item.id) }))
    .filter((item) => item.edits);
  const fail = () => showStatusBanner('Failed to resume paused requests', 'error');
  let cancelled = false;

  // one at a time, so the worker continues each edited request before the rest
  const sendNext = (i) => {
    if (i >= edited.length) {
      if (cancelled) showStatusBanner(CANCELLED_MESSAGE, 'warning');
      sendToWorker({ resumeAllPaused: true, tabId: inspectedTabId }, null, fail);
      return;
    }
    const { id, edits } = edited[i];
    sendToWorker(
      { resumePaused: id, tabId: inspectedTabId, edits },
      (response) => {
        if (response.result === 'cancelled') cancelled = true;
        sendNext(i + 1);
      },
      fail
    );
  };
  sendNext(0);
}

// ── Paused queue ──────────────────────────────────────────────────

/** Rebuild the paused-request list. */
function renderPausedList() {
  const list = byId('bp-paused-list');
  if (!list) return;

  const hadFocus = list.contains(document.activeElement);
  list.textContent = '';
  list.hidden = state.paused.length === 0;

  for (const held of state.paused) {
    const selected = held.id === state.selectedPausedId;
    const cancelled = held.state === 'cancelled';

    const row = document.createElement('div');
    row.className = 'bp-paused-item';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.tabIndex = selected ? 0 : -1;
    row.dataset.pausedId = held.id;
    row.classList.toggle('selected', selected);
    row.classList.toggle('is-cancelled', cancelled);

    const name = document.createElement('span');
    name.className = 'bp-op';
    name.textContent = heldName(held);
    name.classList.toggle('is-anonymous', name.textContent === 'anonymous operation');

    const chip = document.createElement('span');
    chip.className = `state bp-state ${cancelled ? 'bp-state--cancelled' : 'bp-state--paused'}`;
    chip.textContent = cancelled ? 'Cancelled by page' : 'Paused';

    row.append(name, chip);
    row.addEventListener('click', () => selectPaused(held.id));
    list.appendChild(row);
  }

  if (hadFocus) {
    const target = list.querySelector('[aria-selected="true"]');
    (target || list).focus();
  }
}

/** Infobar text for the waiting requests, hidden when none are waiting. */
function renderInfobar() {
  const bar = byId('bp-infobar');
  const text = byId('bp-infobar-text');
  if (!bar || !text) return;

  const waiting = getWaitingPaused();
  const count = waiting.length;
  bar.classList.toggle('hidden', count === 0);
  text.textContent =
    count === 0
      ? ''
      : count === 1
        ? `Paused on ${heldName(waiting[0])}`
        : `Paused · ${count} requests waiting`;
}

/** Empty state, with the interception hint while interception is off. */
function renderEmpty() {
  const empty = byId('bp-empty');
  if (empty) empty.classList.toggle('hidden', state.paused.length > 0);
  const offHint = byId('bp-empty-off');
  if (offHint) offHint.classList.toggle('hidden', state.isDebuggerActive);
}

/** Show the editor column only while something is selected, and tell listeners. */
function renderSelection() {
  const held = selectedHeld();
  const editor = byId('bp-editor');
  if (editor) editor.classList.toggle('hidden', !held);
  renderPausedEditor(held);
  selectionListeners.forEach((listener) => listener(held));
}

/** Clear the selection (editor back button / Escape) and return to the list. */
function clearPausedSelection() {
  state.selectedPausedId = null;
  renderPausedList();
  renderSelection();
  const list = byId('bp-paused-list');
  if (list && !list.hidden) list.focus();
}

/**
 * Select a held request by id.
 * @param {string} id
 */
function selectPaused(id) {
  if (!state.paused.some((item) => item.id === id)) return;
  state.selectedPausedId = id;
  renderPausedList();
  renderSelection();
}

/**
 * Register a listener called with the selected held request (or null)
 * whenever the selection or the queue changes. The request editor uses this.
 * @param {(held: HeldRequest|null) => void} listener
 */
export function onPausedSelected(listener) {
  selectionListeners.push(listener);
}

/**
 * Render the paused queue: list, infobar, toolbar, empty state and the
 * tab-strip status. Newly held requests bring the Breakpoints tab forward;
 * the selection is kept while its request is still held.
 * @param {HeldRequest[]} paused
 * @param {boolean} [pauseNext]
 */
export function renderPaused(paused, pauseNext) {
  const list = Array.isArray(paused) ? paused : [];
  const wasWaiting = getWaitingPaused().length > 0;
  const hasNew = list.some((item) => !seenIds.has(item.id));
  seenIds = new Set(list.map((item) => item.id));

  state.paused = list;
  if (typeof pauseNext === 'boolean') state.pauseNext = pauseNext;
  // a removed selection moves to the next waiting request; a selection the
  // user cleared stays clear until another request pauses
  const cleared = state.selectedPausedId === null && !hasNew;
  if (!cleared && !list.some((item) => item.id === state.selectedPausedId)) {
    const first = list.find((item) => item.state === 'paused') || list[0];
    state.selectedPausedId = first ? first.id : null;
  }

  if (hasNew && getActiveView() !== 'breakpoints') showMainTab('breakpoints');

  renderPausedList();
  renderInfobar();
  renderToolbar();
  renderEmpty();
  renderSelection();

  if (getWaitingPaused().length > 0) updateDebuggerStatus('Paused', 'paused');
  else if (wasWaiting) restoreSessionStatus();
}

/**
 * Handle a `PAUSED_UPDATED` broadcast from the service worker.
 * @param {{tabId?: number, paused?: HeldRequest[], pauseNext?: boolean}} message
 */
export function handlePausedMessage(message) {
  if (!message || message.tabId !== inspectedTabId) return;
  renderPaused(message.paused, message.pauseNext);
}

/** Arrow/Home/End move the selection through the paused list. */
function handlePausedKeydown(e) {
  const ids = state.paused.map((item) => item.id);
  if (ids.length === 0) return;
  const current = ids.indexOf(state.selectedPausedId);
  let next;
  if (e.key === 'ArrowDown') next = Math.min(current + 1, ids.length - 1);
  else if (e.key === 'ArrowUp') next = Math.max(current - 1, 0);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = ids.length - 1;
  else return;

  e.preventDefault();
  selectPaused(ids[next]);
  const row = byId('bp-paused-list')?.querySelector('[aria-selected="true"]');
  if (row) {
    row.focus();
    row.scrollIntoView?.({ block: 'nearest' });
  }
}

// ── Init ──────────────────────────────────────────────────────────

/**
 * Wire the Breakpoints tab and load breakpoints, debug state and any
 * held requests from the service worker.
 */
export function initBreakpointsView() {
  initPausedEditor({ onClose: clearPausedSelection });

  const form = byId('bp-list');
  if (form) form.addEventListener('submit', (e) => e.preventDefault());

  const add = byId('bp-add');
  if (add) {
    add.addEventListener('click', () => {
      const input = addBreakpointRow();
      if (input) input.focus();
    });
  }

  const debugToggle = byId('bp-debug-mode');
  if (debugToggle) {
    debugToggle.addEventListener('change', () => {
      const on = debugToggle.checked;
      sendToWorker({ setDebugMode: on, tabId: inspectedTabId }, applyDebugState, () => {
        debugToggle.checked = !on;
        showStatusBanner('Failed to update debug mode', 'error');
      });
    });
  }

  const pauseNext = byId('bp-pause-next');
  if (pauseNext) {
    pauseNext.addEventListener('click', () => {
      const on = !state.pauseNext;
      state.pauseNext = on;
      renderToolbar();
      sendToWorker({ setPauseNext: on, tabId: inspectedTabId }, applyDebugState, () => {
        state.pauseNext = !on;
        renderToolbar();
        showStatusBanner('Failed to update pause on next request', 'error');
      });
    });
  }

  const resumeAll = byId('bp-resume-all');
  if (resumeAll) resumeAll.addEventListener('click', resumeAllPaused);

  const pausedList = byId('bp-paused-list');
  if (pausedList) {
    pausedList.addEventListener('keydown', handlePausedKeydown);
    pausedList.addEventListener('focus', () => {
      const row = pausedList.querySelector('[aria-selected="true"]');
      if (row) row.focus();
    });
  }

  onTabShown((view) => {
    if (view === 'breakpoints') renderEmpty();
  });

  renderBreakpoints(state.breakpoints);
  renderToolbar();
  renderEmpty();

  sendToWorker(
    { getBreakpointState: true, tabId: inspectedTabId },
    (response) => {
      if (Array.isArray(response.breakpoints)) {
        state.breakpoints = response.breakpoints;
        renderBreakpoints(state.breakpoints);
      }
      applyDebugState(response);
      renderPaused(response.paused, response.pauseNext);
    },
    () => console.warn('Failed to load breakpoint state')
  );
}
