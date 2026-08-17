/**
 * Generate cURL commands from intercepted GraphQL requests and show
 * a modal to pick Bash vs PowerShell formatting.
 * @module ui/curl-copy
 */

import { getElement } from './dom-helpers.js';

/** @type {object|null} Request currently shown in the modal. */
let activeRequest = null;

/**
 * Build the GraphQL POST body for a captured request.
 * @param {object} request
 * @returns {object}
 */
export function buildGraphQLBody(request) {
  const body = {};

  if (request.operationName) {
    body.operationName = request.operationName;
  }

  if (request.query) {
    body.query = request.query;
  }

  if (request.variables && Object.keys(request.variables).length > 0) {
    body.variables = request.variables;
  }

  if (request.hash) {
    body.extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: request.hash,
      },
    };
  }

  return body;
}

/**
 * Captured headers to replay, one per name. Header names are
 * case-insensitive, so a repeated name keeps its first position and the
 * last value sent.
 * @param {object} request
 * @returns {{name: string, value: string}[]}
 */
export function getReplayHeaders(request) {
  if (!request || !Array.isArray(request.headers)) return [];
  const byName = new Map(); // Map.set on an existing key keeps its position
  for (const header of request.headers) {
    if (!header || !header.name || !header.value) continue;
    byName.set(header.name.toLowerCase(), { name: header.name, value: header.value });
  }
  return Array.from(byName.values());
}

/**
 * Find a header by name, ignoring case.
 * @param {{name: string, value: string}[]} headers
 * @param {string} name
 * @returns {{name: string, value: string}|undefined}
 */
function findHeader(headers, name) {
  const wanted = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === wanted);
}

/**
 * Escape a string for use inside single-quoted bash strings.
 * @param {string} value
 * @returns {string}
 */
function bashSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Escape a string for use inside single-quoted PowerShell strings.
 * @param {string} value
 * @returns {string}
 */
function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {string} url
 * @param {object} body
 * @param {{name: string, value: string}[]} [headers]
 * @returns {string}
 */
export function toBashCurl(url, body, headers = []) {
  const json = JSON.stringify(body);
  const lines = [`curl ${bashSingleQuote(url)} \\`, `  -X POST \\`];

  // Defaults only where the captured request didn't send its own value
  for (const [name, value] of [
    ['Content-Type', 'application/json'],
    ['Accept', 'application/json'],
  ]) {
    if (!findHeader(headers, name)) {
      lines.push(`  -H ${bashSingleQuote(`${name}: ${value}`)} \\`);
    }
  }

  for (const header of headers) {
    lines.push(`  -H ${bashSingleQuote(`${header.name}: ${header.value}`)} \\`);
  }

  lines.push(`  --data-raw ${bashSingleQuote(json)}`);
  return lines.join('\n');
}

/**
 * @param {string} url
 * @param {object} body
 * @param {{name: string, value: string}[]} [headers]
 * @returns {string}
 */
export function toPowerShellCurl(url, body, headers = []) {
  const json = JSON.stringify(body);
  const escapedUrl = String(url).replace(/"/g, '`"');
  const lines = [`$body = @'`, json, `'@`, ``];

  // Content-Type travels as -ContentType. It must not also appear in
  // $headers: PowerShell rejects a hashtable literal that repeats a key.
  const contentType = findHeader(headers, 'Content-Type');
  const contentTypeValue = String(contentType ? contentType.value : 'application/json');
  headers = headers.filter((header) => header !== contentType);

  if (headers.length > 0) {
    lines.push(`$headers = @{`);
    for (const header of headers) {
      lines.push(`  ${psSingleQuote(header.name)} = ${psSingleQuote(header.value)}`);
    }
    lines.push(`}`, ``);
  }

  lines.push(`Invoke-RestMethod \``);
  lines.push(`  -Uri "${escapedUrl}" \``);
  lines.push(`  -Method Post \``);
  if (headers.length > 0) {
    lines.push(`  -Headers $headers \``);
  }
  lines.push(`  -ContentType "${contentTypeValue.replace(/"/g, '`"')}" \``);
  lines.push(`  -Body $body`);
  return lines.join('\n');
}

function getCurlText(shell, request) {
  const url = request.url;
  if (!url) return '# No URL available for this request';

  const body = buildGraphQLBody(request);
  const headers = getReplayHeaders(request);
  if (shell === 'powershell') {
    return toPowerShellCurl(url, body, headers);
  }
  return toBashCurl(url, body, headers);
}

function closeModal() {
  const modal = getElement('curl-modal');
  if (modal) modal.classList.add('hidden');
  activeRequest = null;
}

function showPreview(shell) {
  if (!activeRequest) return;

  const preview = getElement('curl-preview');
  const copyBtn = getElement('curl-copy-btn');
  if (!preview) return;

  document.querySelectorAll('.curl-shell-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.shell === shell);
    btn.setAttribute('aria-pressed', String(btn.dataset.shell === shell));
  });

  preview.textContent = getCurlText(shell, activeRequest);
  if (copyBtn) copyBtn.textContent = 'Copy';
}

/**
 * Open the cURL modal for a request.
 * @param {object} request
 */
export function openCurlModal(request) {
  if (!request || !request.url) return;

  activeRequest = request;
  const modal = getElement('curl-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  showPreview('bash');

  const firstOption = modal.querySelector('.curl-shell-option');
  if (firstOption) firstOption.focus();
}

/**
 * Wire up modal controls (shell picker, copy, close).
 */
export function initCurlCopy() {
  const modal = getElement('curl-modal');
  if (!modal) return;

  modal.querySelectorAll('.curl-shell-option').forEach((btn) => {
    btn.addEventListener('click', () => showPreview(btn.dataset.shell));
  });

  const copyBtn = getElement('curl-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const preview = getElement('curl-preview');
      if (!preview) return;

      navigator.clipboard
        .writeText(preview.textContent)
        .then(() => {
          copyBtn.textContent = 'Copied';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 1500);
        })
        .catch((err) => console.error('Failed to copy cURL:', err));
    });
  }

  const closeBtn = getElement('curl-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  const backdrop = modal.querySelector('.modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeModal);

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
    }
  });
}
