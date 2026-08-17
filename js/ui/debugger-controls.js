/**
 * Start / stop debugger orchestration and UI state transitions.
 * @module ui/debugger-controls
 */

import { getElement } from './dom-helpers.js';
import { state, inspectedTabId } from './state.js';
import { updateDebuggerStatus, showStatusBanner, showError } from './status.js';
import { savePatternsToStorage } from './patterns.js';
import { renderSessionBar, setPatternsPaneOpen } from './session.js';

/**
 * Put the record button into its idle or recording appearance.
 * @param {HTMLButtonElement} button
 * @param {boolean} recording
 * @param {string} label
 */
function setRecordButton(button, recording, label) {
  button.classList.toggle('is-recording', recording);
  button.setAttribute('aria-pressed', String(recording));
  button.title = recording ? 'Stop intercepting (Ctrl+E)' : 'Start intercepting (Ctrl+E)';
  const labelEl = button.querySelector('.record-label');
  if (labelEl) labelEl.textContent = label;
  else button.textContent = label;
}

// ── UI state helpers ──────────────────────────────────────────────

/**
 * Reset the start/stop button back to its default "Start" appearance.
 * Clears any in-progress operation state.
 */
export function resetUIState() {
  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = false;
    setRecordButton(submitButton, false, 'Start');
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
    setRecordButton(submitButton, true, 'Stop');
  }
}

// ── Result handlers ───────────────────────────────────────────────

/**
 * Handle a successful debugger attach — update status, badge, and button.
 * @param {string} message - Success message to display in the status banner.
 */
export function handleStartSuccess(message) {
  // The live infobar is the confirmation; the message only goes to the log.
  if (message) console.info(message);
  updateDebuggerStatus('Intercepting', 'active');
  setActiveUIState();
  state.isDebuggerActive = true;
  renderSessionBar();
}

/**
 * Handle a warning during debugger attach (e.g., already attached).
 * @param {string} message - Warning message to display.
 */
export function handleStartWarning(message) {
  updateDebuggerStatus('Warning', 'warning');
  showStatusBanner(message, 'warning');
  resetUIState();
}

/**
 * Handle an error during debugger attach — show error status and reset button.
 * @param {string} error - Error message to display.
 */
export function handleStartError(error) {
  updateDebuggerStatus('Error', 'error');
  showStatusBanner(error, 'error');
  resetUIState();
}

function handleStartTimeout() {
  state.currentOperation = null;
  updateDebuggerStatus('Error', 'error');
  showStatusBanner('Start timed out. Press Start to try again.', 'error');
  resetUIState();
}

export function handleStopSuccess() {
  updateDebuggerStatus(
    state.passiveMode ? 'Passive' : 'Off',
    state.passiveMode ? 'info' : 'default'
  );
  showStatusBanner(sessionRecap(), 'default');
  resetUIState();
  state.isDebuggerActive = false;
  renderSessionBar();
}

/**
 * One-line summary of the session for the stop toast.
 * @returns {string}
 */
function sessionRecap() {
  const captured = state.requestHistory.length;
  if (captured === 0) return 'Interception stopped. No operations were captured.';
  const resolved = state.requestHistory.filter((r) => r.type === 'apq' && r.query).length;
  const hashes = state.requestHistory.filter((r) => r.type === 'apq').length;
  const noun = captured === 1 ? 'operation' : 'operations';
  return hashes > 0
    ? `Interception stopped. ${captured} ${noun} captured; ${resolved} of ${hashes} hashes resolved.`
    : `Interception stopped. ${captured} ${noun} captured.`;
}

/**
 * Handle a warning during debugger detach.
 * @param {string} message - Warning message to display.
 */
export function handleStopWarning(message) {
  updateDebuggerStatus('Warning', 'warning');
  showStatusBanner(message, 'warning');
  resetUIState();
  state.isDebuggerActive = false;
  renderSessionBar();
}

function handleStopError(error) {
  updateDebuggerStatus('Error', 'error');
  showStatusBanner(error, 'error');
  resetUIState();
}

function handleStopTimeout() {
  state.currentOperation = null;
  updateDebuggerStatus('Error', 'error');
  showStatusBanner('Stop timed out. Press Stop to try again.', 'error');
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
        requestStage: 'Request',
      });
    }
  });

  if (urlPatterns.length === 0) {
    setPatternsPaneOpen(true, { user: true });
    const firstInput = document.querySelector('.urlPattern');
    if (firstInput) firstInput.focus();
    showError('Add a URL pattern first, for example *graphql*');
    state.currentOperation = null;
    return;
  }

  savePatternsToStorage();
  updateDebuggerStatus('Starting', 'warning');

  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = true;
    setRecordButton(submitButton, false, 'Starting…');
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

    if (response && response.status === 'SUCCESS') {
      handleStartSuccess(response.message);
    } else if (response && response.status === 'WARNING') {
      handleStartWarning(response.message);
    } else {
      handleStartError(response?.error || 'Unknown error');
    }
  });
}

function stopDebugger() {
  state.currentOperation = 'stopping';
  updateDebuggerStatus('Stopping', 'warning');

  const submitButton = getElement('form-submit');
  if (submitButton) {
    submitButton.disabled = true;
    setRecordButton(submitButton, true, 'Stopping…');
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

    if (response && response.status === 'SUCCESS') {
      handleStopSuccess();
    } else if (response && response.status === 'WARNING') {
      handleStopWarning(response.message);
    } else {
      handleStopError(response?.error || 'Unknown error');
    }
  });
}

function handleToggleDebugger(e) {
  e.preventDefault();

  if (state.currentOperation) {
    console.log('Operation already in progress');
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
