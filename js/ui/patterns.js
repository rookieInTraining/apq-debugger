/**
 * URL pattern field management and storage sync.
 * @module ui/patterns
 */

import { getElement, getPatternInputs, getPatternsFromForm } from './dom-helpers.js';
import { state, PATTERNS_STORAGE_KEY } from './state.js';

/**
 * Persist current pattern values to chrome.storage.local.
 */
export function savePatternsToStorage() {
  const patterns = getPatternsFromForm();
  chrome.storage.local.set({ [PATTERNS_STORAGE_KEY]: patterns }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to save patterns:', chrome.runtime.lastError);
    }
  });
}

/**
 * Restore saved patterns from storage and populate the form.
 */
export function restorePatternsFromStorage() {
  chrome.storage.local.get([PATTERNS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to load patterns:', chrome.runtime.lastError);
      return;
    }

    const patterns = Array.isArray(result[PATTERNS_STORAGE_KEY])
      ? result[PATTERNS_STORAGE_KEY]
      : [];

    const inputs = getPatternInputs();
    if (inputs.length === 0) return;

    if (patterns.length > 0) {
      inputs[0].value = patterns[0];
    }

    for (let i = 1; i < patterns.length; i++) {
      addPatternField(patterns[i]);
    }
  });
}

/**
 * Dynamically add a new pattern input field to the form.
 * @param {string} value - Optional initial value for the new field.
 */
export function addPatternField(value = '') {
  const form = document.querySelector("#myForm");
  if (!form) return;

  const patternItem = document.createElement("div");
  patternItem.className = 'pattern-item';

  const input = document.createElement("input");
  input.type = 'text';
  input.className = 'urlPattern';
  input.setAttribute('data-pattern-index', ++state.totalPatterns);
  input.placeholder = '*graphql*';
  if (value) input.value = value;
  input.addEventListener('input', savePatternsToStorage);

  const removeBtn = document.createElement("button");
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon btn-remove';
  removeBtn.title = 'Remove pattern';
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', () => {
    patternItem.remove();
    savePatternsToStorage();
  });

  patternItem.appendChild(input);
  patternItem.appendChild(removeBtn);
  form.appendChild(patternItem);

  savePatternsToStorage();
}

/**
 * Wire up the "Add Pattern" button and the initial pattern input listener.
 */
export function initPatterns() {
  const addButton = getElement("add");
  if (addButton) {
    addButton.addEventListener('click', () => addPatternField());
  }

  const initialInput = document.querySelector('.urlPattern');
  if (initialInput) {
    initialInput.addEventListener('input', savePatternsToStorage);
  }
}
