/**
 * Main-panel tab switching for the Requests, Schema and Breakpoints views.
 * @module ui/tabs
 */

/** @param {string} id */
const byId = (id) => document.getElementById(id);

/** @typedef {'requests'|'schema'|'breakpoints'} MainView */

/** @type {MainView[]} */
const VIEWS = ['requests', 'schema', 'breakpoints'];

/** @type {MainView} */
let activeView = 'requests';

/** @type {Array<(view: MainView) => void>} */
const shownListeners = [];

/**
 * Switch the visible main-panel view.
 * @param {MainView} view
 */
export function showMainTab(view) {
  if (!VIEWS.includes(view)) return;
  if (!byId(`tab-${view}`) || !byId(`${view}-content`)) return;

  activeView = view;
  for (const name of VIEWS) {
    const tab = byId(`tab-${name}`);
    const content = byId(`${name}-content`);
    const selected = name === view;
    if (tab) {
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    }
    if (content) content.classList.toggle('hidden', !selected);
  }
  shownListeners.forEach((listener) => listener(view));
}

/** @deprecated Use showMainTab('schema') */
export function showDetailTab(tab) {
  showMainTab(tab === 'schema' ? 'schema' : 'requests');
}

/**
 * The view currently showing.
 * @returns {MainView}
 */
export function getActiveView() {
  return activeView;
}

/**
 * Register a listener called after a view is shown.
 * @param {(view: MainView) => void} listener
 */
export function onTabShown(listener) {
  shownListeners.push(listener);
}

/**
 * Wire up click handling on the main tabs.
 */
export function initTabs() {
  for (const name of VIEWS) {
    const tab = byId(`tab-${name}`);
    if (tab) tab.addEventListener('click', () => showMainTab(name));
  }
}
