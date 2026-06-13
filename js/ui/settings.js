/**
 * User-customizable panel settings: theme override and density.
 * Persisted to chrome.storage.local and applied as data attributes
 * on the root element so CSS can react.
 * @module ui/settings
 */

import { getElement } from './dom-helpers.js';
import { UI_SETTINGS_STORAGE_KEY } from '../shared/constants.js';

const DEFAULT_SETTINGS = { theme: 'system', density: 'comfortable' };

let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Apply settings to the document root as data attributes.
 * `theme: system` removes the attribute so the prefers-color-scheme
 * media query takes over.
 * @param {{theme: string, density: string}} settings
 */
export function applySettings(settings) {
  const root = document.documentElement;

  if (settings.theme === 'light' || settings.theme === 'dark') {
    root.setAttribute('data-theme', settings.theme);
  } else {
    root.removeAttribute('data-theme');
  }

  if (settings.density === 'compact') {
    root.setAttribute('data-density', 'compact');
  } else {
    root.removeAttribute('data-density');
  }
}

/**
 * Get the currently active settings.
 * @returns {{theme: string, density: string}}
 */
export function getSettings() {
  return { ...currentSettings };
}

function saveSettings() {
  chrome.storage.local.set({ [UI_SETTINGS_STORAGE_KEY]: currentSettings }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to save UI settings:', chrome.runtime.lastError);
    }
  });
}

function syncRadios(popover) {
  popover.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === currentSettings.theme;
  });
  popover.querySelectorAll('input[name="density"]').forEach((input) => {
    input.checked = input.value === currentSettings.density;
  });
}

/**
 * Wire up the settings gear button and popover, and restore
 * persisted settings from storage.
 */
export function initSettings() {
  const button = getElement('btn-settings');
  const popover = getElement('settings-popover');
  if (!button || !popover) return;

  // Restore persisted settings
  chrome.storage.local.get([UI_SETTINGS_STORAGE_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to load UI settings:', chrome.runtime.lastError);
      return;
    }
    const stored = result[UI_SETTINGS_STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
    }
    applySettings(currentSettings);
    syncRadios(popover);
  });

  const closePopover = () => {
    popover.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const isOpen = !popover.classList.contains('hidden');
    if (isOpen) {
      closePopover();
    } else {
      popover.classList.remove('hidden');
      button.setAttribute('aria-expanded', 'true');
      const firstChecked = popover.querySelector('input:checked');
      if (firstChecked) firstChecked.focus();
    }
  });

  // Close on outside click or Escape
  document.addEventListener('click', (e) => {
    if (popover.classList.contains('hidden')) return;
    if (!popover.contains(e.target) && e.target !== button && !button.contains(e.target)) {
      closePopover();
    }
  });

  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
      button.focus();
    }
  });

  // Radio changes
  popover.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || !input.name) return;

    if (input.name === 'theme') {
      currentSettings.theme = input.value;
    } else if (input.name === 'density') {
      currentSettings.density = input.value;
    }

    applySettings(currentSettings);
    saveSettings();
  });
}
