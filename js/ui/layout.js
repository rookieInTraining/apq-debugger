/**
 * Responsive layout management: width-driven panel collapse and the
 * manual sidebar toggle. Class changes are picked up by devtools.css
 * (.app.narrow, .app.very-narrow, .app.sidebar-collapsed, .sidebar-open).
 * @module ui/layout
 */

import { getElement } from './dom-helpers.js';

const NARROW_PX = 560;
const VERY_NARROW_PX = 400;

function applyBreakpoints(app, width) {
  app.classList.toggle('narrow', width < NARROW_PX);
  const veryNarrow = width < VERY_NARROW_PX;
  const wasVeryNarrow = app.classList.contains('very-narrow');
  app.classList.toggle('very-narrow', veryNarrow);

  // Close the drawer when entering very-narrow so it doesn't cover content
  if (veryNarrow && !wasVeryNarrow) {
    app.classList.remove('sidebar-open');
    syncToggleButton(app);
  }
}

function syncToggleButton(app) {
  const button = document.getElementById('btn-toggle-sidebar');
  if (!button) return;

  const veryNarrow = app.classList.contains('very-narrow');
  const visible = veryNarrow
    ? app.classList.contains('sidebar-open')
    : !app.classList.contains('sidebar-collapsed');
  button.setAttribute('aria-expanded', String(visible));
}

/**
 * Initialise responsive breakpoints and the sidebar toggle button.
 */
export function initLayout() {
  const app = document.querySelector('.app');
  if (!app) return;

  const toggleButton = getElement('btn-toggle-sidebar');
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      if (app.classList.contains('very-narrow')) {
        app.classList.toggle('sidebar-open');
      } else {
        app.classList.toggle('sidebar-collapsed');
      }
      syncToggleButton(app);
    });
  }

  applyBreakpoints(app, window.innerWidth);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        applyBreakpoints(app, entry.contentRect.width);
      }
    });
    observer.observe(app);
  } else {
    window.addEventListener('resize', () => applyBreakpoints(app, window.innerWidth));
  }
}
