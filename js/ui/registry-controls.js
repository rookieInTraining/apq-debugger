/**
 * Passive mode toggle and hash registry controls in the sidebar.
 * @module ui/registry-controls
 */

import { getElement } from './dom-helpers.js';
import { showStatusBanner } from './status.js';

/**
 * Update the registry UI (size counter, clear button, passive-mode toggle)
 * from a service-worker payload.
 * @param {{size?: number, passiveMode?: boolean}} info
 */
export function updateRegistryUI(info) {
  if (!info || typeof info !== 'object') return;

  if (info.size !== undefined) {
    const sizeEl = getElement('registry-size');
    if (sizeEl) sizeEl.textContent = info.size;

    const clearBtn = getElement('btn-clear-registry');
    if (clearBtn) clearBtn.disabled = info.size === 0;
  }

  if (info.passiveMode !== undefined) {
    const toggle = getElement('passive-mode-toggle');
    if (toggle) toggle.checked = info.passiveMode;
  }
}

/**
 * Wire up the passive-mode toggle and clear-registry button,
 * and fetch the initial registry state from the service worker.
 */
export function initRegistryControls() {
  const toggle = getElement('passive-mode-toggle');
  if (toggle) {
    toggle.addEventListener('change', () => {
      const enabled = toggle.checked;
      chrome.runtime.sendMessage({ setPassiveMode: enabled }, (response) => {
        if (chrome.runtime.lastError || !response || response.status !== 'SUCCESS') {
          toggle.checked = !enabled;
          showStatusBanner('Failed to update passive mode', 'error');
          return;
        }
        updateRegistryUI(response);
        showStatusBanner(
          enabled
            ? 'Passive mode on — requests will not be modified'
            : 'Passive mode off — APQ hashes will be contaminated',
          'success'
        );
      });
    });
  }

  const clearBtn = getElement('btn-clear-registry');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ clearRegistry: true }, (response) => {
        if (chrome.runtime.lastError || !response || response.status !== 'SUCCESS') {
          showStatusBanner('Failed to clear hash registry', 'error');
          return;
        }
        updateRegistryUI(response);
        showStatusBanner('Hash registry cleared', 'success');
      });
    });
  }

  // Fetch initial registry state
  chrome.runtime.sendMessage({ getRegistry: true }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to get registry state:', chrome.runtime.lastError);
      return;
    }
    if (response && response.status === 'SUCCESS') {
      updateRegistryUI(response);
    }
  });
}
