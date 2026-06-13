/**
 * Keyboard navigation and shortcuts:
 * - Ctrl+Shift+D toggles the debugger (matches the Start button aria-label)
 * - Escape closes the detail panel
 * - Arrow/Home/End navigation within the request list (roving focus)
 * - Arrow/Home/End navigation within the schema type list (roving focus)
 * - Arrow navigation within the filter chip radio group
 * @module ui/keyboard
 */

import { getElement } from './dom-helpers.js';
import { state } from './state.js';

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function getRequestItems() {
  return Array.from(document.querySelectorAll('#request-list .request-item'));
}

function getSchemaTypeItems() {
  return Array.from(document.querySelectorAll('#schema-type-list .schema-type-item'));
}

/**
 * @param {HTMLElement[]} items
 * @param {number} index
 */
function focusItem(items, index) {
  if (index < 0 || index >= items.length) return;
  items.forEach((item, i) => item.setAttribute('tabindex', i === index ? '0' : '-1'));
  items[index].focus();
}

function handleListKeydown(e) {
  const items = getRequestItems();
  if (items.length === 0) return;

  const currentIndex = items.indexOf(document.activeElement);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusItem(items, currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusItem(items, currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0));
      break;
    case 'Home':
      e.preventDefault();
      focusItem(items, 0);
      break;
    case 'End':
      e.preventDefault();
      focusItem(items, items.length - 1);
      break;
    case 'Enter':
    case ' ':
      if (currentIndex >= 0) {
        e.preventDefault();
        items[currentIndex].click();
      }
      break;
  }
}

function handleSchemaListKeydown(e) {
  const items = getSchemaTypeItems();
  if (items.length === 0) return;

  const currentIndex = items.indexOf(document.activeElement);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusSchemaItem(items, currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusSchemaItem(items, currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0));
      break;
    case 'Home':
      e.preventDefault();
      focusSchemaItem(items, 0);
      break;
    case 'End':
      e.preventDefault();
      focusSchemaItem(items, items.length - 1);
      break;
    case 'Enter':
    case ' ':
      if (currentIndex >= 0) {
        e.preventDefault();
        items[currentIndex].click();
      }
      break;
  }
}

/**
 * Focus a schema type option and update the SDL panel (single-select listbox).
 * @param {HTMLElement[]} items
 * @param {number} index
 */
function focusSchemaItem(items, index) {
  if (index < 0 || index >= items.length) return;
  focusItem(items, index);
  items[index].click();
  items[index].scrollIntoView?.({ block: 'nearest' });
}

function handleChipKeydown(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

  const chips = Array.from(document.querySelectorAll('.filter-chips .chip'));
  const currentIndex = chips.indexOf(document.activeElement);
  if (currentIndex < 0) return;

  e.preventDefault();
  const delta = e.key === 'ArrowRight' ? 1 : -1;
  const next = (currentIndex + delta + chips.length) % chips.length;
  chips[next].focus();
  chips[next].click();
}

/**
 * Wire up global and per-region keyboard handling.
 */
export function initKeyboard() {
  const requestList = getElement('request-list');
  if (requestList) {
    requestList.addEventListener('keydown', handleListKeydown);

    // Tabbing into the list focuses the selected (or first) item
    requestList.addEventListener('focus', () => {
      const items = getRequestItems();
      if (items.length === 0) return;
      const selectedIndex = items.findIndex(
        (item) => parseInt(item.dataset.requestId) === state.selectedRequestId
      );
      focusItem(items, selectedIndex >= 0 ? selectedIndex : 0);
    });
  }

  const schemaTypeList = getElement('schema-type-list');
  if (schemaTypeList) {
    schemaTypeList.addEventListener('keydown', handleSchemaListKeydown);

    schemaTypeList.addEventListener('focus', () => {
      const items = getSchemaTypeItems();
      if (items.length === 0) return;
      const selectedIndex = items.findIndex((item) => item.getAttribute('aria-selected') === 'true');
      focusItem(items, selectedIndex >= 0 ? selectedIndex : 0);
    });
  }

  const chipGroup = document.querySelector('.filter-chips');
  if (chipGroup) {
    chipGroup.addEventListener('keydown', handleChipKeydown);
  }

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D: toggle debugger
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      const submitButton = getElement('form-submit');
      if (submitButton) submitButton.click();
      return;
    }

    // Escape: close the detail panel (unless typing in a field)
    if (e.key === 'Escape' && !isEditableTarget(e.target)) {
      const detailPanel = getElement('detail-panel');
      if (detailPanel && !detailPanel.classList.contains('hidden')) {
        const closeBtn = getElement('close-detail');
        if (closeBtn) closeBtn.click();

        const list = getElement('request-list');
        if (list) list.focus();
      }
    }
  });
}
