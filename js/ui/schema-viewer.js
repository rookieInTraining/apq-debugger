/**
 * Schema viewer: "Request / Schema" tab switch in the detail panel and
 * searchable rendering of the loaded schema SDL, split per type block.
 * @module ui/schema-viewer
 */

import { getElement, escapeHtml } from './dom-helpers.js';

/** @type {{text: string, html: string}[]} Parsed SDL blocks for filtering. */
let schemaBlocks = [];

function highlightSDL(block) {
  return escapeHtml(block)
    .replace(
      /\b(type|input|enum|interface|union|scalar|schema|directive|implements|extend|on)\b/g,
      '<span class="keyword">$1</span>'
    )
    .replace(/\b(String|Int|Float|Boolean|ID)\b/g, '<span class="type">$1</span>');
}

/**
 * Switch the visible detail-panel tab.
 * @param {'request'|'schema'} tab
 */
export function showDetailTab(tab) {
  const requestTab = getElement('tab-request');
  const schemaTab = getElement('tab-schema');
  const requestContent = getElement('detail-content');
  const schemaContent = getElement('schema-content');
  if (!requestTab || !schemaTab || !requestContent || !schemaContent) return;

  const showSchema = tab === 'schema';
  requestTab.setAttribute('aria-selected', String(!showSchema));
  schemaTab.setAttribute('aria-selected', String(showSchema));
  requestContent.classList.toggle('hidden', showSchema);
  schemaContent.classList.toggle('hidden', !showSchema);
}

function renderBlocks(filterText) {
  const container = getElement('schema-types');
  if (!container) return;

  const search = (filterText || '').trim().toLowerCase();
  const visible = search
    ? schemaBlocks.filter((block) => block.text.toLowerCase().includes(search))
    : schemaBlocks;

  if (visible.length === 0) {
    container.innerHTML = `<div class="schema-empty">${
      schemaBlocks.length === 0 ? 'No schema loaded' : 'No types match your search'
    }</div>`;
    return;
  }

  container.innerHTML = visible
    .map((block) => `<div class="schema-type-block"><pre>${block.html}</pre></div>`)
    .join('');
}

/**
 * Render a loaded schema in the viewer and enable the Schema tab.
 * @param {string} sdl - Printed schema SDL.
 * @param {{endpoint: string, typeCount: number, fetchedAt: number}} meta
 */
export function setSchema(sdl, meta) {
  schemaBlocks = (sdl || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({ text: block, html: highlightSDL(block) }));

  const metaEl = getElement('schema-meta');
  if (metaEl && meta) {
    const when = meta.fetchedAt ? new Date(meta.fetchedAt).toLocaleString() : '';
    metaEl.textContent = `${meta.typeCount} types — ${meta.endpoint}${when ? ` — ${when}` : ''}`;
  }

  const schemaTab = getElement('tab-schema');
  if (schemaTab) schemaTab.disabled = false;

  const searchInput = getElement('schema-search');
  renderBlocks(searchInput ? searchInput.value : '');
}

/**
 * Wire up the detail-panel tabs and the schema search box.
 */
export function initSchemaViewer() {
  const requestTab = getElement('tab-request');
  const schemaTab = getElement('tab-schema');

  if (requestTab) {
    requestTab.addEventListener('click', () => showDetailTab('request'));
  }
  if (schemaTab) {
    schemaTab.addEventListener('click', () => {
      if (!schemaTab.disabled) showDetailTab('schema');
    });
  }

  const searchInput = getElement('schema-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderBlocks(e.target.value));
  }
}
