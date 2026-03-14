/**
 * Start / stop debugger orchestration and UI state transitions.
 * @module ui/debugger-controls
 */

import { getElement } from './dom-helpers.js';
import { state, inspectedTabId } from './state.js';
import { updateDebuggerStatus, showStatusBanner, showError } from './status.js';
import { savePatternsToStorage } from './patterns.js';

// ── UI state helpers ──────────────────────────────────────────────

/**
 * Reset the start/stop button back to its default "Start" appearance.
 * Clears any in-progress operation state.
 */
export function resetUIState() {
  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.innerHTML = '<span class="btn-icon-play">&#9654;</span> Start';
    submitButton.className = 'btn btn-primary btn-block';
  }
  state.currentOperation = null;
}

/**
 * Switch the start/stop button to the "Stop" (active) appearance.
 */
export function setActiveUIState() {
  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.innerHTML = '<span class="btn-icon-play">&#9209;</span> Stop';
    submitButton.className = 'btn btn-danger btn-block';
  }
}

// ── Result handlers ───────────────────────────────────────────────

/**
 * Handle a successful debugger attach — update status, badge, and button.
 * @param {string} message - Success message to display in the status banner.
 */
export function handleStartSuccess(message) {
  updateDebuggerStatus("Active", "active");
  showStatusBanner(message, 'success');
  setActiveUIState();
  state.isDebuggerActive = true;
}

/**
 * Handle a warning during debugger attach (e.g., already attached).
 * @param {string} message - Warning message to display.
 */
export function handleStartWarning(message) {
  updateDebuggerStatus("Warning", "warning");
  showStatusBanner(message, 'warning');
  resetUIState();
}

/**
 * Handle an error during debugger attach — show error status and reset button.
 * @param {string} error - Error message to display.
 */
export function handleStartError(error) {
  updateDebuggerStatus("Failed", "error");
  showStatusBanner(error, 'error');
  resetUIState();
}

function handleStartTimeout() {
  state.currentOperation = null;
  updateDebuggerStatus("Timeout", "error");
  showStatusBanner("Start operation timed out", 'error');
  resetUIState();
}

export function handleStopSuccess() {
  updateDebuggerStatus("Stopped", "error");
  showStatusBanner("Debugger disconnected", 'warning');
  resetUIState();
  state.isDebuggerActive = false;
}

/**
 * Handle a warning during debugger detach.
 * @param {string} message - Warning message to display.
 */
export function handleStopWarning(message) {
  updateDebuggerStatus("Warning", "warning");
  showStatusBanner(message, 'warning');
  resetUIState();
  state.isDebuggerActive = false;
}

function handleStopError(error) {
  updateDebuggerStatus("Error", "error");
  showStatusBanner(error, 'error');
  resetUIState();
}

function handleStopTimeout() {
  state.currentOperation = null;
  updateDebuggerStatus("Timeout", "error");
  showStatusBanner("Stop operation timed out", 'error');
  resetUIState();
}

// ── Debugger operations ───────────────────────────────────────────

function startDebugger() {
  state.currentOperation = 'starting';

  const urlPatterns = [];
  document.querySelectorAll('.pattern-item').forEach((d) => {
    const input = d.querySelector('.urlPattern');
    if (input && input.value.trim()) {
      urlPatterns.push({
        urlPattern: input.value.trim(),
        requestType: 'XHR',
        requestStage: 'Request'
      });
    }
  });

  if (urlPatterns.length === 0) {
    showError("Please enter at least one URL pattern");
    state.currentOperation = null;
    return;
  }

  savePatternsToStorage();
  updateDebuggerStatus("Connecting...", "warning");

  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="btn-icon-play">&#9203;</span> Starting...';
  }

  const startTimeout = setTimeout(() => {
    handleStartTimeout();
  }, 15000);

  chrome.runtime.sendMessage({ patterns: urlPatterns, tabId: inspectedTabId }, (response) => {
    clearTimeout(startTimeout);
    state.currentOperation = null;

    if (chrome.runtime.lastError) {
      handleStartError(chrome.runtime.lastError.message);
      return;
    }

    if (response && response.status === "SUCCESS") {
      handleStartSuccess(response.message);
    } else if (response && response.status === "WARNING") {
      handleStartWarning(response.message);
    } else {
      handleStartError(response?.error || "Unknown error");
    }
  });
}

function stopDebugger() {
  state.currentOperation = 'stopping';
  updateDebuggerStatus("Disconnecting...", "warning");

  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="btn-icon-play">&#9203;</span> Stopping...';
  }

  const stopTimeout = setTimeout(() => {
    handleStopTimeout();
  }, 10000);

  chrome.runtime.sendMessage({ disconnect: true, tabId: inspectedTabId }, (response) => {
    clearTimeout(stopTimeout);
    state.currentOperation = null;

    if (chrome.runtime.lastError) {
      handleStopError(chrome.runtime.lastError.message);
      return;
    }

    if (response && response.status === "SUCCESS") {
      handleStopSuccess();
    } else if (response && response.status === "WARNING") {
      handleStopWarning(response.message);
    } else {
      handleStopError(response?.error || "Unknown error");
    }
  });
}

function handleToggleDebugger(e) {
  e.preventDefault();

  if (state.currentOperation) {
    console.log("Operation already in progress");
    return;
  }

  if (state.isDebuggerActive) {
    stopDebugger();
  } else {
    startDebugger();
  }
}

/**
 * Attach the click listener to the start/stop button.
 */
export function initDebuggerControls() {
  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.addEventListener('click', handleToggleDebugger);
  }
}
