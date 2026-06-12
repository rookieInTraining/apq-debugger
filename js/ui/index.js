/**
 * DevTools panel entry point.
 * Creates the panel, initialises all UI modules, and wires up message listeners.
 */

import { state, inspectedTabId } from './state.js';
import { initPatterns, restorePatternsFromStorage } from './patterns.js';
import { initRequestList, addRequest, renderRequestList } from './request-list.js';
import { initRequestDetail } from './request-detail.js';
import { updateDebuggerStatus, showStatusBanner } from './status.js';
import {
  initDebuggerControls,
  resetUIState,
  handleStartSuccess,
  handleStartError,
  handleStopSuccess,
} from './debugger-controls.js';
import { initRegistryControls, updateRegistryUI } from './registry-controls.js';
import { initSettings } from './settings.js';
import { initResize } from './resize.js';
import { initToolbar } from './toolbar.js';
import { initLayout } from './layout.js';
import { initKeyboard } from './keyboard.js';
import { initSchemaControls, updateSchemaProgress } from './schema-controls.js';
import { initSchemaViewer } from './schema-viewer.js';

// ── Panel registration ────────────────────────────────────────────

chrome.devtools.panels.create(
  'APQ Debugger',
  'icons/icon128.png',
  'devtools.html',
  function (panel) {
    console.log('APQ Debugger panel created:', panel);
  }
);

// ── DOM ready ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  // Initialise UI modules
  initPatterns();
  initRequestList();
  initRequestDetail();
  initDebuggerControls();
  initRegistryControls();
  initSettings();
  initResize();
  initToolbar();
  initLayout();
  initKeyboard();
  initSchemaViewer();
  initSchemaControls();

  // ── Message listeners ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Guard against null/invalid messages
    if (!message || typeof message !== 'object') {
      return;
    }

    // Filter messages not meant for this tab
    if (message.tabId !== undefined && message.tabId !== inspectedTabId) {
      return;
    }

    try {
      if (message.status === 'INTERCEPTED') {
        addRequest({
          operationName: message.operationName || 'Unknown Query',
          url: message.url || '',
          isAPQ: message.isAPQ !== false,
          hash: message.hash || '',
          query: message.query || '',
          variables: message.variables || null,
          responseTime: message.responseTime || null,
        });

        try {
          sendResponse({ status: 'Message received' });
        } catch (_) {
          /* port may be closed */
        }
      } else if (message.status === 'REGISTRY_UPDATED') {
        updateRegistryUI(message);
      } else if (message.status === 'SCHEMA_PROGRESS') {
        updateSchemaProgress(message.message || '');
      } else if (message.status === 'ACTION_TOGGLE') {
        if (message.error) {
          handleStartError(message.error);
          return;
        }

        if (message.active) {
          handleStartSuccess(message.message || 'Debugger attached via toolbar');
        } else {
          handleStopSuccess();
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      try {
        sendResponse({ status: 'Error processing message' });
      } catch (_) {
        /* port may be closed */
      }
    }
  });

  // ── Debugger detachment listener ──────────────────────────────

  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId !== inspectedTabId) return;

    state.currentOperation = null;
    state.isDebuggerActive = false;

    const reasonMessages = {
      target_closed: 'Tab closed',
      canceled_by_user: 'Manually detached',
    };

    updateDebuggerStatus('Disconnected', 'error');
    showStatusBanner(
      `Debugger disconnected: ${reasonMessages[reason] || 'Unknown reason'}`,
      'warning'
    );
    resetUIState();
  });

  // ── Extension suspend handler ─────────────────────────────────

  chrome.runtime.onSuspend.addListener(() => {
    resetUIState();
    updateDebuggerStatus('Suspended', 'error');
  });

  // ── Initialisation ────────────────────────────────────────────

  console.log('APQ Debugger DevTools panel initialized');
  updateDebuggerStatus('Ready', 'default');
  restorePatternsFromStorage();
  renderRequestList();

  // Check if the debugger is already attached to this tab
  chrome.runtime.sendMessage({ getStatus: true, tabId: inspectedTabId }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Failed to get debugger status:', chrome.runtime.lastError);
      return;
    }

    if (response && response.status === 'SUCCESS' && response.debuggerActive) {
      console.log('Debugger already active on tab:', inspectedTabId);
      handleStartSuccess('Debugger is already active on this tab');
    }
  });
});
