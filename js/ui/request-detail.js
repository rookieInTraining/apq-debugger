/**
 * Request detail panel: selection, rendering, and copy-to-clipboard.
 * @module ui/request-detail
 */

import { getElement, escapeHtml } from './dom-helpers.js';
import { state } from './state.js';
import { showDetailTab } from './schema-viewer.js';

/**
 * Mark a request as selected and show the detail panel.
 * @param {number} requestId
 */
export function selectRequest(requestId) {
  state.selectedRequestId = requestId;

  // Update visual + ARIA selection in the list
  document.querySelectorAll('.request-item').forEach((item) => {
    const isSelected = parseInt(item.dataset.requestId) === requestId;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', String(isSelected));
  });

  const detailPanel = getElement('detail-panel');
  if (detailPanel) detailPanel.classList.remove('hidden');

  // Selecting a request always brings the Request tab forward
  showDetailTab('request');

  renderRequestDetail(requestId);
}

/**
 * Render the detail panel content for a given request.
 * @param {number} requestId
 */
export function renderRequestDetail(requestId) {
  const request = state.requestHistory.find((r) => r.id === requestId);
  const detailContent = getElement('detail-content');
  if (!request || !detailContent) return;

  const formattedQuery = request.query ? formatGraphQL(request.query) : 'No query available';
  let variablesJson = null;
  try {
    variablesJson = request.variables ? JSON.stringify(request.variables, null, 2) : null;
  } catch (e) {
    console.error('Failed to stringify variables:', e);
    variablesJson = '(unable to display variables)';
  }

  detailContent.innerHTML = `
    <div class="detail-section">
        <div class="detail-label">Operation</div>
        <div class="detail-value">${escapeHtml(request.operationName)}</div>
    </div>
    
    <div class="detail-section">
        <div class="detail-label">Type</div>
        <div class="detail-value">
            <span class="request-badge ${request.type}">${request.type.toUpperCase()}</span>
        </div>
    </div>
    
    ${
      request.hash
        ? `
    <div class="detail-section">
        <div class="detail-label">SHA256 Hash</div>
        <div class="detail-hash">${escapeHtml(request.hash)}</div>
    </div>
    `
        : ''
    }
    
    <div class="detail-section">
        <div class="detail-label">URL</div>
        <div class="detail-value" style="font-family: var(--font-mono); font-size: 11px; word-break: break-all;">${escapeHtml(request.url)}</div>
    </div>
    
    <div class="detail-section">
        <div class="code-block">
            <div class="code-header">
                <span class="code-title">GraphQL Query</span>
                <button class="btn btn-copy" data-copy="query">Copy</button>
            </div>
            <pre class="code-content">${formattedQuery}</pre>
        </div>
    </div>
    
    ${
      variablesJson
        ? `
    <div class="detail-section">
        <div class="code-block">
            <div class="code-header">
                <span class="code-title">Variables</span>
                <button class="btn btn-copy" data-copy="variables">Copy</button>
            </div>
            <pre class="code-content">${escapeHtml(variablesJson)}</pre>
        </div>
    </div>
    `
        : ''
    }
  `;

  // Attach copy-to-clipboard handlers
  detailContent.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      try {
        const type = btn.dataset.copy;
        const text = type === 'query' ? request.query : JSON.stringify(request.variables, null, 2);
        copyToClipboard(text, btn);
      } catch (e) {
        console.error('Failed to prepare copy content:', e);
      }
    });
  });
}

/**
 * Basic GraphQL syntax highlighting (keywords, types, variables).
 * @param {string} query
 * @returns {string} HTML string with <span> wrappers.
 */
export function formatGraphQL(query) {
  return escapeHtml(query)
    .replace(/\b(query|mutation|subscription|fragment|on)\b/g, '<span class="keyword">$1</span>')
    .replace(/\b(String|Int|Float|Boolean|ID|!)\b/g, '<span class="type">$1</span>')
    .replace(/\$(\w+)/g, '<span class="variable">$$1</span>');
}

/**
 * Copy text to the clipboard and briefly update the button label.
 * @param {string} text
 * @param {HTMLButtonElement} button
 */
function copyToClipboard(text, button) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    })
    .catch((err) => {
      console.error('Failed to copy:', err);
    });
}

/**
 * Wire up the close button for the detail panel.
 */
export function initRequestDetail() {
  const closeDetailBtn = getElement('close-detail');
  if (closeDetailBtn) {
    closeDetailBtn.addEventListener('click', () => {
      const detailPanel = getElement('detail-panel');
      if (detailPanel) detailPanel.classList.add('hidden');
      state.selectedRequestId = null;
      document.querySelectorAll('.request-item.selected').forEach((el) => {
        el.classList.remove('selected');
        el.setAttribute('aria-selected', 'false');
      });
    });
  }
}
