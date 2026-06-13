/**
 * Schema viewer: main-panel Schema tab with a searchable type list and
 * lazy per-definition SDL rendering for large schemas.
 * @module ui/schema-viewer
 */

import { getElement, escapeHtml } from './dom-helpers.js';
import { highlightSDL } from './sdl-highlighter.js';

/** @typedef {{ name: string, kind: string, text: string }} SchemaEntry */

/** @type {SchemaEntry[]} */
let schemaEntries = [];

/** @type {string | null} */
let selectedName = null;

/** @type {number} */
let parseGeneration = 0;

/** @type {ReturnType<typeof setTimeout> | null} */
let searchDebounceTimer = null;

const DEFINITION_KEYWORD = /^(type|input|enum|interface|union|scalar|schema|extend|directive)\s/;
const DEFINITION_NAME =
  /^(?:(extend)\s+)?(type|input|enum|interface|union|scalar|schema|directive)\s+(\w+)/;

function isBlankLine(line) {
  return line.trim() === '';
}

function isDefinitionLine(line) {
  return DEFINITION_KEYWORD.test(line.trim()) && !/^\s/.test(line);
}

/**
 * @param {string} line
 * @param {boolean} inBlockString
 * @returns {boolean}
 */
function advanceBlockString(line, inBlockString) {
  const trimmed = line.trim();
  if (!inBlockString) {
    if (!trimmed.startsWith('"""')) return false;
    const closedOnSameLine = trimmed.endsWith('"""') && trimmed.length > 3;
    return !closedOnSameLine;
  }
  if (trimmed.endsWith('"""')) return false;
  return true;
}

/**
 * @param {string[]} lines
 * @param {number} endIdx
 * @returns {number}
 */
function descriptionStartIndex(lines, endIdx) {
  let i = endIdx;
  while (i >= 0 && isBlankLine(lines[i])) i--;
  if (i < 0) return -1;

  const endLine = lines[i].trim();
  if (!endLine.endsWith('"""')) return -1;

  if (endLine.startsWith('"""') && endLine.length > 3) return i;

  // Multi-line block string: walk back past the closing delimiter.
  i--;
  while (i >= 0) {
    if (lines[i].trim().startsWith('"""')) return i;
    i--;
  }
  return -1;
}

/**
 * @param {string[]} lines
 * @returns {number}
 */
function findSplitIndex(lines) {
  let end = lines.length;
  while (end > 0 && isBlankLine(lines[end - 1])) end--;

  const descStart = end > 0 ? descriptionStartIndex(lines, end - 1) : -1;
  return descStart >= 0 ? descStart : end;
}

/**
 * @param {string} block
 * @returns {{ name: string, kind: string }}
 */
function extractDefinitionName(block) {
  for (const line of block.split('\n')) {
    if (/^\s/.test(line)) continue;
    const trimmed = line.trim();
    const directiveMatch = trimmed.match(/^(?:extend\s+)?directive\s+@(\w+)/);
    if (directiveMatch) return { name: directiveMatch[1], kind: 'directive' };
    const match = trimmed.match(DEFINITION_NAME);
    if (!match) continue;
    if (match[2] === 'schema') return { name: 'schema', kind: 'schema' };
    return { name: match[3], kind: match[2] };
  }
  return { name: 'Unknown', kind: 'unknown' };
}

/**
 * Split printed SDL into top-level definition blocks.
 * @param {string} sdl
 * @returns {string[]}
 */
function parseSchemaBlocks(sdl) {
  if (!sdl) return [];

  const lines = sdl.split('\n');
  const blocks = [];
  let current = [];
  let inBlockString = false;

  for (const line of lines) {
    inBlockString = advanceBlockString(line, inBlockString);

    if (!inBlockString && isDefinitionLine(line) && current.length > 0) {
      const splitAt = findSplitIndex(current);
      const prefix = current.slice(0, splitAt);
      const suffix = current.slice(splitAt);

      if (prefix.length > 0) {
        blocks.push(prefix.join('\n').trim());
      }
      current = suffix;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n').trim());
  }

  return blocks.filter((block) => block.length > 0);
}

/**
 * @param {() => void} fn
 */
function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 500 });
  } else {
    setTimeout(fn, 0);
  }
}

/** @type {boolean} */
let schemaLoaded = false;

/**
 * Whether a schema is currently loaded in the viewer.
 * @returns {boolean}
 */
export function isSchemaLoaded() {
  return schemaLoaded;
}

/**
 * Switch the visible main-panel tab.
 * @param {'requests'|'schema'} tab
 */
export function showMainTab(tab) {
  const requestsTab = getElement('tab-requests');
  const schemaTab = getElement('tab-schema');
  const requestsContent = getElement('requests-content');
  const schemaContent = getElement('schema-content');
  const requestsToolbar = document.getElementById('requests-toolbar');
  if (!requestsTab || !schemaTab || !requestsContent || !schemaContent) return;

  const showSchema = tab === 'schema';
  requestsTab.setAttribute('aria-selected', String(!showSchema));
  schemaTab.setAttribute('aria-selected', String(showSchema));
  requestsContent.classList.toggle('hidden', showSchema);
  schemaContent.classList.toggle('hidden', !showSchema);
  if (requestsToolbar) {
    requestsToolbar.classList.toggle('hidden', showSchema);
  }
}

/** @deprecated Use showMainTab('schema') */
export function showDetailTab(tab) {
  showMainTab(tab === 'schema' ? 'schema' : 'requests');
}

function setExplorerVisible(visible) {
  const explorer = getElement('schema-explorer');
  if (explorer) explorer.classList.toggle('hidden', !visible);
}

function getSearchValue() {
  const searchInput = getElement('schema-search');
  return searchInput ? searchInput.value : '';
}

/**
 * @param {string | null} name
 */
function selectType(name) {
  selectedName = name;
  const list = getElement('schema-type-list');
  const view = getElement('schema-sdl-view');
  if (!list || !view) return;

  list.querySelectorAll('.schema-type-item').forEach((item) => {
    const selected = item.dataset.typeName === name;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-selected', String(selected));
    item.setAttribute('tabindex', selected ? '0' : '-1');
  });

  const entry = schemaEntries.find((item) => item.name === name);
  if (!entry) {
    view.textContent = '';
    return;
  }

  view.innerHTML = highlightSDL(entry.text);
}

/**
 * @param {string} filterText
 */
function renderTypeList(filterText) {
  const list = getElement('schema-type-list');
  if (!list) return;

  const search = (filterText || '').trim().toLowerCase();
  const visible = search
    ? schemaEntries.filter((entry) => entry.name.toLowerCase().includes(search))
    : schemaEntries;

  list.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'schema-type-list-empty';
    empty.textContent = schemaEntries.length === 0 ? 'Indexing types…' : 'No types match your filter';
    list.appendChild(empty);
    const view = getElement('schema-sdl-view');
    if (view) view.textContent = '';
    selectedName = null;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'schema-type-item';
    button.dataset.typeName = entry.name;
    button.setAttribute('role', 'option');
    button.setAttribute('tabindex', '-1');
    button.innerHTML = `<span class="kind">${escapeHtml(entry.kind)}</span><span class="name">${escapeHtml(entry.name)}</span>`;
    if (entry.name === selectedName) {
      button.classList.add('selected');
      button.setAttribute('aria-selected', 'true');
    }
    fragment.appendChild(button);
  }
  list.appendChild(fragment);

  if (!selectedName || !visible.some((entry) => entry.name === selectedName)) {
    selectType(visible[0].name);
  } else {
    selectType(selectedName);
  }
}

function indexSchema(sdl) {
  parseGeneration += 1;
  const generation = parseGeneration;
  schemaEntries = [];
  selectedName = null;
  setExplorerVisible(true);
  renderTypeList('');

  scheduleIdle(() => {
    if (generation !== parseGeneration) return;

    schemaEntries = parseSchemaBlocks(sdl)
      .map((text) => ({ text, ...extractDefinitionName(text) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    renderTypeList(getSearchValue());
  });
}

/**
 * Render a loaded schema in the viewer.
 * @param {string | null | undefined} sdl - Printed schema SDL; falsy clears the viewer.
 * @param {{endpoint: string, typeCount: number, fetchedAt: number}} [meta]
 */
export function setSchema(sdl, meta) {
  const metaEl = getElement('schema-meta');
  if (metaEl) {
    if (meta) {
      const when = meta.fetchedAt ? new Date(meta.fetchedAt).toLocaleString() : '';
      metaEl.textContent = `${meta.typeCount} types — ${meta.endpoint}${when ? ` — ${when}` : ''}`;
    } else if (!sdl) {
      metaEl.textContent = '';
    }
  }

  if (!sdl) {
    parseGeneration += 1;
    schemaEntries = [];
    selectedName = null;
    schemaLoaded = false;
    setExplorerVisible(false);

    const list = getElement('schema-type-list');
    if (list) list.replaceChildren();

    const view = getElement('schema-sdl-view');
    if (view) view.textContent = '';

    const searchInput = getElement('schema-search');
    if (searchInput) searchInput.value = '';
    return;
  }

  schemaLoaded = true;
  indexSchema(sdl);
}

/**
 * Wire up the main-panel tabs, type list, and schema search box.
 */
export function initSchemaViewer() {
  const requestsTab = getElement('tab-requests');
  const schemaTab = getElement('tab-schema');

  if (requestsTab) {
    requestsTab.addEventListener('click', () => showMainTab('requests'));
  }
  if (schemaTab) {
    schemaTab.addEventListener('click', () => showMainTab('schema'));
  }

  const typeList = getElement('schema-type-list');
  if (typeList) {
    typeList.addEventListener('click', (event) => {
      const item = event.target.closest('.schema-type-item');
      if (!item) return;
      selectType(item.dataset.typeName);
    });
  }

  const searchInput = getElement('schema-search');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => renderTypeList(event.target.value), 150);
    });
  }
}
