/**
 * Request detail panel: selection, rendering, and copy-to-clipboard.
 * The recovered query is the panel's main content; metadata stays to one
 * compact key/value block above it.
 * @module ui/request-detail
 */

import { getElement, escapeHtml } from './dom-helpers.js';
import { state } from './state.js';
import { openCurlModal } from './curl-copy.js';
import { getRequestState, isAnonymousOperation } from './request-state.js';

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

  renderRequestDetail(requestId);
}

function copyButton(kind, label) {
  return `<button type="button" class="tb-btn btn-copy" data-copy="${kind}" aria-label="${label}">Copy</button>`;
}

/**
 * Render the detail panel content for a given request.
 * @param {number} requestId
 */
export function renderRequestDetail(requestId) {
  const request = state.requestHistory.find((r) => r.id === requestId);
  const detailContent = getElement('detail-content');
  if (!request || !detailContent) return;

  let variablesJson = null;
  try {
    variablesJson = request.variables ? JSON.stringify(request.variables, null, 2) : null;
  } catch (e) {
    console.error('Failed to stringify variables:', e);
    variablesJson = '(unable to display variables)';
  }

  const rowState = getRequestState(request);
  const anonymous = isAnonymousOperation(request.operationName);
  const name = anonymous ? '(anonymous)' : request.operationName;

  const title = document.getElementById('detail-title');
  if (title) {
    title.textContent = name;
    title.classList.toggle('is-anonymous', anonymous);
  }

  const time = request.timestamp.toLocaleTimeString('en-US', { hour12: false });
  const linked = findLinkedRequest(request);

  const queryBody = request.query
    ? `<pre class="code code-content" tabindex="0" aria-label="GraphQL query">${formatGraphQL(prettyPrintGraphQL(request.query))}</pre>`
    : `<p class="code-missing">${escapeHtml(rowState.description)}</p>`;

  detailContent.innerHTML = `
    <div class="detail-facts">
        <span class="state state--${rowState.key}">${rowState.label}</span>
        ${request.type === 'apq' ? '<span class="detail-fact">APQ request</span>' : ''}
        <span class="detail-fact">${escapeHtml(time)}</span>
        ${
          linked
            ? `<button type="button" class="link-btn" id="btn-linked-request">${
                request.type === 'full' ? 'Show hash row' : 'Show retry request'
              }</button>`
            : ''
        }
        ${variablesJson ? '<a class="link-btn" href="#detail-variables">Variables</a>' : ''}
    </div>
    ${request.query ? `<p class="detail-note">${escapeHtml(rowState.description)}</p>` : ''}

    <dl class="kv">
        <dt>Endpoint</dt>
        <dd class="mono kv-url">${escapeHtml(request.url || '—')}</dd>
        ${
          request.hash
            ? `<dt>Hash</dt>
        <dd class="mono kv-hash"><span class="detail-hash">${escapeHtml(request.hash)}</span>${copyButton('hash', 'Copy hash')}</dd>`
            : ''
        }
    </dl>

    ${
      request.url
        ? `<div class="detail-actions">
        <button type="button" class="tb-btn" id="btn-copy-curl">Copy as cURL</button>
    </div>`
        : ''
    }

    <details class="code-block code-block--query" open>
        <summary class="code-header"><h3 class="code-title">Query</h3></summary>
        ${request.query ? copyButton('query', 'Copy query') : ''}
        ${queryBody}
    </details>

    ${
      variablesJson
        ? `<details class="code-block" id="detail-variables" open>
        <summary class="code-header"><h3 class="code-title">Variables</h3></summary>
        ${copyButton('variables', 'Copy variables')}
        <pre class="code code-content" tabindex="0" aria-label="Variables JSON">${escapeHtml(variablesJson)}</pre>
    </details>`
        : ''
    }
  `;

  // Attach copy-to-clipboard handlers
  detailContent.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      try {
        const type = btn.dataset.copy;
        let text = request.query;
        if (type === 'variables') text = JSON.stringify(request.variables, null, 2);
        else if (type === 'hash') text = request.hash;
        copyToClipboard(text, btn);
      } catch (e) {
        console.error('Failed to prepare copy content:', e);
      }
    });
  });

  const linkedBtn = detailContent.querySelector('#btn-linked-request');
  if (linkedBtn && linked) {
    linkedBtn.addEventListener('click', () => {
      selectRequest(linked.id);
      const row = document.querySelector(`.request-item[data-request-id="${linked.id}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        document.querySelectorAll('#request-list .request-item').forEach((item) => {
          item.setAttribute('tabindex', item === row ? '0' : '-1');
        });
        row.focus();
      }
    });
  }

  const variablesLink = detailContent.querySelector('a[href="#detail-variables"]');
  if (variablesLink) {
    variablesLink.addEventListener('click', (e) => {
      e.preventDefault();
      const section = detailContent.querySelector('#detail-variables');
      if (!section) return;
      section.open = true;
      section.scrollIntoView({ block: 'start' });
    });
  }

  const curlBtn = detailContent.querySelector('#btn-copy-curl');
  if (curlBtn) {
    curlBtn.addEventListener('click', () => openCurlModal(request));
  }
}

/**
 * The other half of an APQ exchange: for a retry, the hash row it
 * resolved; for a resolved hash row, the retry that resolved it.
 * @param {object} request
 * @returns {object|null}
 */
function findLinkedRequest(request) {
  if (!request.hash) return null;
  if (request.type === 'full') {
    return (
      state.requestHistory.find(
        (r) => r.type === 'apq' && r.hash === request.hash && r.resolvedBy === request.id
      ) || null
    );
  }
  if (request.resolvedBy) {
    return state.requestHistory.find((r) => r.id === request.resolvedBy) || null;
  }
  return null;
}

/**
 * Pretty-print a single-line GraphQL document (as minified clients send it)
 * with two-space indentation. Documents that already contain line breaks
 * are returned unchanged. String literals are copied verbatim.
 * @param {string} query
 * @returns {string}
 */
export function prettyPrintGraphQL(query) {
  if (!query || query.includes('\n')) return query;

  const indent = (depth) => '  '.repeat(Math.max(depth, 0));
  let out = '';
  let depth = 0;
  let parens = 0;
  let i = 0;

  const trimEnd = () => {
    out = out.replace(/[ \t]+$/, '');
  };

  while (i < query.length) {
    const ch = query[i];

    // Copy string literals ("..." and """...""") untouched
    if (ch === '"') {
      const block = query.startsWith('"""', i);
      const end = block ? query.indexOf('"""', i + 3) : findStringEnd(query, i + 1);
      const stop = end < 0 ? query.length : end + (block ? 3 : 1);
      out += query.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '(') parens++;
    if (ch === ')') parens = Math.max(parens - 1, 0);

    if (ch === '{' && parens === 0) {
      trimEnd();
      depth++;
      out += ' {\n' + indent(depth);
      i++;
      while (query[i] === ' ') i++;
      continue;
    }

    if (ch === '}' && parens === 0) {
      trimEnd();
      depth--;
      out = out.replace(/\n\s*$/, '');
      out += '\n' + indent(depth) + '}';
      i++;
      while (query[i] === ' ') i++;
      if (i < query.length && query[i] !== '}') out += depth > 0 ? '\n' + indent(depth) : '\n\n';
      continue;
    }

    // Whitespace between selections becomes a line break; whitespace inside
    // arguments, after a colon, around "on" / "...", or before "{", "(", "@"
    // stays a single space.
    if (ch === ' ' && depth > 0 && parens === 0) {
      let j = i;
      while (query[j] === ' ') j++;
      const next = query[j];
      const before = out.trimEnd();
      const keepSpace =
        next === '{' ||
        next === '(' ||
        next === '@' ||
        next === ':' ||
        before.endsWith(':') ||
        before.endsWith('...') ||
        /\bon$/.test(before) ||
        query.startsWith('on ', j);
      out += keepSpace ? ' ' : '\n' + indent(depth);
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return out.trim();
}

function findStringEnd(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '"') return i;
  }
  return -1;
}

/**
 * Basic GraphQL syntax highlighting (strings, keywords, types, variables).
 * @param {string} query
 * @returns {string} HTML string with <span> wrappers.
 */
export function formatGraphQL(query) {
  return escapeHtml(query)
    .replace(/&quot;(?:[^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
    .replace(/\b(query|mutation|subscription|fragment|on)\b/g, '<span class="keyword">$1</span>')
    .replace(/\b(String|Int|Float|Boolean|ID)\b/g, '<span class="type">$1</span>')
    .replace(/(:\s*\[?)([A-Z]\w*)/g, '$1<span class="type">$2</span>')
    .replace(/(on<\/span>\s+)([A-Z]\w*)/g, '$1<span class="type">$2</span>')
    .replace(/\$(\w+)/g, '<span class="variable">$$$1</span>');
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
      button.textContent = 'Copied';
      button.classList.add('is-done');
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('is-done');
      }, 1500);
    })
    .catch((err) => {
      console.error('Failed to copy:', err);
    });
}

/**
 * Hide the detail panel and clear the selection.
 */
export function closeRequestDetail() {
  const detailPanel = getElement('detail-panel');
  if (detailPanel) detailPanel.classList.add('hidden');
  state.selectedRequestId = null;
  document.querySelectorAll('.request-item.selected').forEach((el) => {
    el.classList.remove('selected');
    el.setAttribute('aria-selected', 'false');
  });
}

/**
 * Wire up the close button for the detail panel.
 */
export function initRequestDetail() {
  const closeDetailBtn = getElement('close-detail');
  if (closeDetailBtn) {
    closeDetailBtn.addEventListener('click', closeRequestDetail);
  }
}
