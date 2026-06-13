/**
 * Request panel toolbar: clear history and export history as JSON.
 * @module ui/toolbar
 */

import { getElement } from './dom-helpers.js';
import { state } from './state.js';
import { renderRequestList, updateRequestCount } from './request-list.js';
import { showStatusBanner } from './status.js';

/**
 * Enable/disable the toolbar buttons based on history length.
 * Called from request-list whenever the history changes.
 */
export function updateToolbarState() {
  const hasHistory = state.requestHistory.length > 0;
  const clearBtn = document.getElementById('btn-clear-history');
  const exportBtn = document.getElementById('btn-export-history');
  if (clearBtn) clearBtn.disabled = !hasHistory;
  if (exportBtn) exportBtn.disabled = !hasHistory;
}

function clearHistory() {
  state.requestHistory = [];
  state.selectedRequestId = null;
  renderRequestList();
  updateRequestCount();
  updateToolbarState();

  const detailContent = getElement('detail-content');
  if (detailContent) {
    detailContent.innerHTML =
      '<div class="detail-placeholder"><p>Select a request to view details</p></div>';
  }

  showStatusBanner('Request history cleared', 'success');
}

function exportHistory() {
  if (state.requestHistory.length === 0) return;

  try {
    const data = state.requestHistory.map((req) => ({
      timestamp: req.timestamp instanceof Date ? req.timestamp.toISOString() : req.timestamp,
      operationName: req.operationName,
      url: req.url,
      type: req.type,
      hash: req.hash,
      query: req.query,
      variables: req.variables,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `apq-requests-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to export history:', error);
    showStatusBanner('Failed to export request history', 'error');
  }
}

/**
 * Wire up the Clear and Export toolbar buttons.
 */
export function initToolbar() {
  const clearBtn = getElement('btn-clear-history');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearHistory);
  }

  const exportBtn = getElement('btn-export-history');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportHistory);
  }

  updateToolbarState();
}
