/**
 * Paused request editor (#bp-editor): edit a held request's query, variables
 * and headers, then resume, fail or revert it. Unsent edits are kept per held
 * id while the panel is open.
 * @module ui/paused-editor
 */

import { state, inspectedTabId } from './state.js';
import { showStatusBanner } from './status.js';

/** @typedef {import('./breakpoints-view.js').HeldRequest} HeldRequest */
/** @typedef {import('./breakpoints-view.js').HeldOperation} HeldOperation */

/**
 * Edits sent with `resumePaused` (mirrors `ResumeEdits` in js/sw/resume-body.js).
 * @typedef {object} ResumeEdits
 * @property {{index: number, query?: string, variables?: unknown}[]} [operations]
 * @property {Record<string,string>} [headers]
 */

/** @typedef {'query'|'variables'|'headers'} Part */

/**
 * Unsent text for one held request. `query` and `variables` are keyed by
 * position in `operations` and hold only text that differs from the original.
 * @typedef {object} Draft
 * @property {number} op - Position of the operation shown.
 * @property {Part} part - Sub-tab shown.
 * @property {Record<number,string>} query
 * @property {Record<number,string>} variables
 * @property {string} [headers]
 */

/** @typedef {{part: Part, op: number, message: string}} EditError */

/** Toast shown when the page gave up on a request before it was resumed. */
export const CANCELLED_MESSAGE = 'The page cancelled this request before it was resumed.';

const NOTE_NONE =
  'Not in registry — the query text is unknown. You can still edit variables and headers.';
const NOTE_REGISTRY =
  'Filled from the hash registry. Edit it to send the full query instead of the hash.';

/** @type {Part[]} */
const PARTS = ['query', 'variables', 'headers'];

/** RFC 7230 header field name (`token`). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** CR or LF, which would split a header value into another header. */
const LINE_BREAK = /[\r\n]/;

/** @param {string} id */
const byId = (id) => document.getElementById(id);

/** @type {Map<string, Draft>} */
const drafts = new Map();

/** @type {HeldRequest|null} The request on screen. */
let current = null;
/** Id and state last rendered; the fields are only rebuilt when this changes. */
let renderedKey = null;
/** @type {() => void} */
let closeEditor = () => {};

// ── Originals and drafts ──────────────────────────────────────────

/**
 * @param {HeldRequest} held
 * @param {Part} part
 * @param {number} op
 * @returns {string}
 */
function originalText(held, part, op) {
  if (part === 'headers') return JSON.stringify(held.rawHeaders || {}, null, 2);
  const operation = (held.operations || [])[op];
  if (!operation) return '';
  if (part === 'query') return operation.query || '';
  return JSON.stringify(operation.variables ?? {}, null, 2);
}

/**
 * @param {string} id
 * @returns {Draft}
 */
function draftFor(id) {
  let draft = drafts.get(id);
  if (!draft) {
    draft = { op: 0, part: 'query', query: {}, variables: {} };
    drafts.set(id, draft);
  }
  return draft;
}

/**
 * Current text of a part: the draft when edited, otherwise the original.
 * @param {HeldRequest} held
 * @param {Part} part
 * @param {number} op
 * @returns {string}
 */
function currentText(held, part, op) {
  const draft = drafts.get(held.id);
  if (draft) {
    if (part === 'headers' && draft.headers !== undefined) return draft.headers;
    if (part !== 'headers' && draft[part][op] !== undefined) return draft[part][op];
  }
  return originalText(held, part, op);
}

/**
 * @param {Draft|undefined} draft
 * @param {Part} part
 * @returns {boolean}
 */
function partEdited(draft, part) {
  if (!draft) return false;
  if (part === 'headers') return draft.headers !== undefined;
  return Object.keys(draft[part]).length > 0;
}

/**
 * Whether a held request has unsent text that differs from the original.
 * @param {string} id
 * @returns {boolean}
 */
export function hasEdits(id) {
  const draft = drafts.get(id);
  return PARTS.some((part) => partEdited(draft, part));
}

/**
 * @param {HeldRequest} held
 * @param {Part} part
 * @param {number} op
 * @param {string} text
 */
function storeText(held, part, op, text) {
  const draft = draftFor(held.id);
  const unchanged = text === originalText(held, part, op);
  if (part === 'headers') {
    if (unchanged) delete draft.headers;
    else draft.headers = text;
  } else if (unchanged) delete draft[part][op];
  else draft[part][op] = text;
}

// ── Building edits ────────────────────────────────────────────────

/**
 * @param {Record<string,string>} obj
 * @returns {string}
 */
function sortedJson(obj) {
  return JSON.stringify(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The first header Chrome could not send: a name that isn't an HTTP token, or a
 * value with a line break.
 * @param {Record<string,string>} headers
 * @returns {string|null} The message to show, or null when every header is valid.
 */
function headerProblem(headers) {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) return `Header name "${name}" isn't valid.`;
    if (LINE_BREAK.test(value)) return `Header "${name}" has a line break in its value.`;
  }
  return null;
}

/**
 * Turn a held request's draft into resume edits holding only the changed parts.
 * @param {HeldRequest} held
 * @returns {{edits: ResumeEdits|null, error: EditError|null}}
 */
function buildEdits(held) {
  const draft = drafts.get(held.id);
  if (!draft) return { edits: null, error: null };

  const operations = [];
  const ops = held.operations || [];
  for (let op = 0; op < ops.length; op++) {
    const operation = ops[op];
    const entry = { index: operation.index };
    const query = draft.query[op];
    if (query !== undefined && operation.querySource !== 'none') entry.query = query;

    const variablesText = draft.variables[op];
    if (variablesText !== undefined) {
      let variables;
      try {
        variables = JSON.parse(variablesText);
      } catch (e) {
        return {
          edits: null,
          error: { part: 'variables', op, message: `Variables aren't valid JSON: ${e.message}` },
        };
      }
      if (JSON.stringify(variables) !== JSON.stringify(operation.variables ?? {})) {
        entry.variables = variables;
      }
    }
    if ('query' in entry || 'variables' in entry) operations.push(entry);
  }

  /** @type {ResumeEdits} */
  const edits = {};
  if (operations.length) edits.operations = operations;

  if (draft.headers !== undefined) {
    let headers;
    try {
      headers = JSON.parse(draft.headers);
    } catch (e) {
      return {
        edits: null,
        error: {
          part: 'headers',
          op: draft.op,
          message: `Headers aren't valid JSON: ${e.message}`,
        },
      };
    }
    const isStringMap =
      headers !== null &&
      typeof headers === 'object' &&
      !Array.isArray(headers) &&
      Object.values(headers).every((value) => typeof value === 'string');
    if (!isStringMap) {
      return {
        edits: null,
        error: {
          part: 'headers',
          op: draft.op,
          message: 'Headers must be a JSON object of strings.',
        },
      };
    }
    const headerError = headerProblem(headers);
    if (headerError) {
      return { edits: null, error: { part: 'headers', op: draft.op, message: headerError } };
    }
    if (sortedJson(headers) !== sortedJson(held.rawHeaders || {})) edits.headers = headers;
  }

  return { edits: Object.keys(edits).length ? edits : null, error: null };
}

/**
 * @param {string} id
 * @returns {HeldRequest|null}
 */
function findHeld(id) {
  return state.paused.find((item) => item.id === id) || null;
}

/**
 * The changed parts of a held request's edits, ready for `resumePaused`.
 * @param {string} id
 * @returns {ResumeEdits|null} Null when nothing changed or the edits are invalid.
 */
export function getPendingEdits(id) {
  const held = findHeld(id);
  return held ? buildEdits(held).edits : null;
}

/**
 * The first problem with a held request's edits (invalid JSON or headers).
 * @param {string} id
 * @returns {string|null} The message to show, or null when the edits are valid.
 */
export function getEditError(id) {
  const held = findHeld(id);
  const error = held ? buildEdits(held).error : null;
  return error ? error.message : null;
}

// ── Rendering ─────────────────────────────────────────────────────

/** @param {string} [message] */
function setError(message) {
  const el = byId('bp-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

/** Reflect the shown sub-tab in the tab strip and panels. */
function renderPart() {
  const part = current ? draftFor(current.id).part : 'query';
  for (const name of PARTS) {
    const tab = byId(`bp-tab-${name}`);
    const panel = byId(`bp-panel-${name}`);
    const selected = name === part;
    if (tab) {
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (panel) panel.classList.toggle('hidden', !selected);
  }
}

/** Show or hide each sub-tab's `edited` marker. */
function renderMarkers() {
  const draft = current ? drafts.get(current.id) : undefined;
  for (const part of PARTS) {
    const mark = byId(`bp-tab-${part}`)?.querySelector('.bp-edited');
    if (mark) mark.classList.toggle('hidden', !partEdited(draft, part));
  }
}

/** Fill the fields for the shown operation. */
function renderFields() {
  if (!current) return;
  const held = current;
  const draft = draftFor(held.id);
  const operation = (held.operations || [])[draft.op];
  const cancelled = held.state === 'cancelled';
  const source = operation ? operation.querySource : 'none';

  const query = byId('bp-query');
  if (query) {
    query.value = currentText(held, 'query', draft.op);
    query.readOnly = cancelled || source === 'none';
  }
  const note = byId('bp-query-note');
  if (note) {
    note.textContent = source === 'none' ? NOTE_NONE : source === 'registry' ? NOTE_REGISTRY : '';
    note.classList.toggle('hidden', !note.textContent);
  }
  const variables = byId('bp-variables');
  if (variables) {
    variables.value = currentText(held, 'variables', draft.op);
    variables.readOnly = cancelled;
  }
  const headers = byId('bp-headers');
  if (headers) {
    headers.value = currentText(held, 'headers', draft.op);
    headers.readOnly = cancelled;
  }
  renderMarkers();
}

/** Rebuild the whole editor for `current`. */
function renderAll() {
  const held = current;
  const draft = draftFor(held.id);
  const ops = held.operations || [];
  if (draft.op >= ops.length) draft.op = 0;

  const title = byId('bp-editor-title');
  if (title) {
    const names = ops.map((op) => op.operationName).filter(Boolean);
    title.textContent = names.length ? names.join(', ') : 'anonymous operation';
  }

  const select = byId('bp-operation');
  if (select) {
    select.textContent = '';
    ops.forEach((op, pos) => {
      const option = document.createElement('option');
      option.value = String(pos);
      option.textContent = op.operationName || 'anonymous operation';
      select.appendChild(option);
    });
    select.value = String(draft.op);
    select.classList.toggle('hidden', ops.length <= 1);
  }

  const cancelled = held.state === 'cancelled';
  for (const id of ['bp-resume', 'bp-revert', 'bp-fail']) {
    byId(id)?.classList.toggle('hidden', cancelled);
  }
  byId('bp-remove')?.classList.toggle('hidden', !cancelled);

  setError();
  renderPart();
  renderFields();
  setBusy(false);
}

/**
 * Show a held request in the editor (or nothing). The fields are rebuilt only
 * when the selected id or its state changes, so queue updates never overwrite
 * text being typed. Drafts of requests no longer held are dropped.
 * @param {HeldRequest|null} held
 */
export function renderPausedEditor(held) {
  const ids = new Set(state.paused.map((item) => item.id));
  for (const id of drafts.keys()) if (!ids.has(id)) drafts.delete(id);

  current = held || null;
  if (!current) {
    renderedKey = null;
    return;
  }
  const key = `${current.id}\n${current.state}`;
  if (key === renderedKey) return;
  renderedKey = key;
  renderAll();
}

/**
 * Show an edit problem: switch to the field at fault, show the message, focus it.
 * Only acts when `id` is the request on screen.
 * @param {string} id
 */
export function showEditError(id) {
  if (!current || current.id !== id) return;
  const { error } = buildEdits(current);
  if (!error) return;
  const draft = draftFor(id);
  if (error.part !== 'headers' && draft.op !== error.op) {
    draft.op = error.op;
    const select = byId('bp-operation');
    if (select) select.value = String(error.op);
    renderFields();
  }
  draft.part = error.part;
  renderPart();
  setError(error.message);
  byId(`bp-${error.part}`)?.focus();
}

// ── Actions ───────────────────────────────────────────────────────

/** @param {boolean} busy */
function setBusy(busy) {
  for (const id of ['bp-resume', 'bp-revert', 'bp-fail', 'bp-remove']) {
    const button = byId(id);
    if (button) button.disabled = busy;
  }
}

/**
 * Send an action for the request on screen.
 * @param {object} message
 * @param {string} failure - Toast text when the worker cannot be reached.
 * @param {boolean} warnIfCancelled
 */
function sendAction(message, failure, warnIfCancelled) {
  const id = current.id;
  setBusy(true);
  chrome.runtime.sendMessage({ ...message, tabId: inspectedTabId }, (response) => {
    if (current && current.id === id) setBusy(false);
    if (chrome.runtime.lastError || !response || response.status !== 'SUCCESS') {
      showStatusBanner(failure, 'error');
      return;
    }
    drafts.delete(id);
    if (warnIfCancelled && response.result === 'cancelled') {
      showStatusBanner(CANCELLED_MESSAGE, 'warning');
    }
  });
}

/** Resume this: validate, then send only the changed parts. */
function resumeCurrent() {
  if (!current) return;
  const { edits, error } = buildEdits(current);
  if (error) {
    showEditError(current.id);
    return;
  }
  const message = { resumePaused: current.id };
  if (edits) message.edits = edits;
  sendAction(message, 'Failed to resume request', true);
}

/** Revert edits: restore the originals and clear the markers. */
function revertCurrent() {
  if (!current) return;
  const draft = draftFor(current.id);
  draft.query = {};
  draft.variables = {};
  delete draft.headers;
  setError();
  renderFields();
}

/** @param {Part} part */
function selectPart(part) {
  if (!current) return;
  draftFor(current.id).part = part;
  renderPart();
}

/** Arrow/Home/End move between the sub-tabs. */
function handleSubtabKeydown(e) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const index = PARTS.findIndex((part) => byId(`bp-tab-${part}`) === document.activeElement);
  if (index < 0) return;
  e.preventDefault();
  let next = index;
  if (e.key === 'ArrowRight') next = (index + 1) % PARTS.length;
  else if (e.key === 'ArrowLeft') next = (index - 1 + PARTS.length) % PARTS.length;
  else if (e.key === 'Home') next = 0;
  else next = PARTS.length - 1;
  selectPart(PARTS[next]);
  byId(`bp-tab-${PARTS[next]}`)?.focus();
}

// ── Init ──────────────────────────────────────────────────────────

/**
 * Wire the editor's fields and buttons.
 * @param {{onClose?: () => void}} [options] - `onClose` clears the selection
 *   (back button, or Escape outside a text field).
 */
export function initPausedEditor({ onClose } = {}) {
  closeEditor = onClose || (() => {});
  current = null;
  renderedKey = null;

  const editor = byId('bp-editor');
  if (!editor) return;

  for (const part of PARTS) {
    byId(`bp-tab-${part}`)?.addEventListener('click', () => selectPart(part));
    const field = byId(`bp-${part}`);
    if (field) {
      field.addEventListener('input', () => {
        if (!current || field.readOnly) return;
        storeText(current, part, draftFor(current.id).op, field.value);
        setError();
        renderMarkers();
      });
    }
  }
  editor.querySelector('.bp-subtabs')?.addEventListener('keydown', handleSubtabKeydown);

  const select = byId('bp-operation');
  if (select) {
    select.addEventListener('change', () => {
      if (!current) return;
      draftFor(current.id).op = Number(select.value) || 0;
      setError();
      renderFields();
    });
  }

  byId('bp-resume')?.addEventListener('click', resumeCurrent);
  byId('bp-revert')?.addEventListener('click', revertCurrent);
  byId('bp-fail')?.addEventListener('click', () => {
    if (current) sendAction({ failPaused: current.id }, 'Failed to fail request', true);
  });
  byId('bp-remove')?.addEventListener('click', () => {
    if (current) sendAction({ failPaused: current.id }, 'Failed to remove request', false);
  });
  byId('bp-editor-back')?.addEventListener('click', () => closeEditor());

  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || (e.target && e.target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    e.stopPropagation();
    closeEditor();
  });
}
