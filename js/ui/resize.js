/**
 * Draggable + keyboard-resizable panel widths with persistence.
 * Wires the separator handles between sidebar / request panel,
 * request panel / detail panel, and schema type list / SDL view.
 * @module ui/resize
 */

import { getElement } from './dom-helpers.js';
import { PANEL_WIDTHS_STORAGE_KEY } from '../shared/constants.js';

const LIMITS = {
  sidebar: { min: 150, max: 420 },
  detail: { min: 240, max: 560 },
  schemaList: { min: 140, max: 480 },
};

const KEYBOARD_STEP = 16;

let widths = { sidebar: null, detail: null };
let saveTimer = null;

function persistWidths() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ [PANEL_WIDTHS_STORAGE_KEY]: widths }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to save panel widths:', chrome.runtime.lastError);
      }
    });
  }, 300);
}

function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value));
}

function applyWidth(panel, key, value) {
  const clamped = clamp(value, LIMITS[key]);
  panel.style.width = `${clamped}px`;
  panel.style.minWidth = `${clamped}px`;
  widths[key] = clamped;
  return clamped;
}

/**
 * Wire one resize handle.
 * @param {HTMLElement} handle - The separator element.
 * @param {HTMLElement} panel - The panel whose width changes.
 * @param {'sidebar'|'detail'|'schemaList'} key - Storage key / limits entry.
 * @param {1|-1} direction - +1 if dragging right grows the panel.
 */
function wireHandle(handle, panel, key, direction) {
  handle.setAttribute('aria-valuemin', LIMITS[key].min);
  handle.setAttribute('aria-valuemax', LIMITS[key].max);

  const updateAria = (w) => handle.setAttribute('aria-valuenow', Math.round(w));

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const applied = applyWidth(panel, key, startWidth + direction * dx);
      updateAria(applied);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      persistWidths();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  handle.addEventListener('keydown', (e) => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -KEYBOARD_STEP;
    else if (e.key === 'ArrowRight') delta = KEYBOARD_STEP;
    else return;

    e.preventDefault();
    const current = panel.getBoundingClientRect().width;
    const applied = applyWidth(panel, key, current + direction * delta);
    updateAria(applied);
    persistWidths();
  });
}

/**
 * Initialise resize handles and restore persisted widths.
 */
export function initResize() {
  const sidebar = getElement('patterns-sidebar');
  const detailPanel = getElement('detail-panel');
  const leftHandle = getElement('resize-handle-left');
  const rightHandle = getElement('resize-handle-right');
  const schemaList = getElement('schema-type-list');
  const schemaHandle = getElement('resize-handle-schema');

  if (sidebar && leftHandle) {
    wireHandle(leftHandle, sidebar, 'sidebar', 1);
  }
  if (detailPanel && rightHandle) {
    wireHandle(rightHandle, detailPanel, 'detail', -1);
  }
  if (schemaList && schemaHandle) {
    wireHandle(schemaHandle, schemaList, 'schemaList', 1);
  }

  chrome.storage.local.get([PANEL_WIDTHS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) return;
    const stored = result[PANEL_WIDTHS_STORAGE_KEY];
    if (!stored || typeof stored !== 'object') return;

    if (typeof stored.sidebar === 'number' && sidebar) {
      applyWidth(sidebar, 'sidebar', stored.sidebar);
    }
    if (typeof stored.detail === 'number' && detailPanel) {
      applyWidth(detailPanel, 'detail', stored.detail);
    }
    if (typeof stored.schemaList === 'number' && schemaList) {
      applyWidth(schemaList, 'schemaList', stored.schemaList);
    }
  });
}
