/**
 * Responsive layout: width-driven classes on .app that CSS uses to drop
 * low-priority columns and to show the detail pane as an overlay when
 * the panel is too narrow for a side-by-side split
 * (.app.narrow, .app.very-narrow).
 * @module ui/layout
 */

const NARROW_PX = 640;
const VERY_NARROW_PX = 420;

function applyBreakpoints(app, width) {
  app.classList.toggle('narrow', width < NARROW_PX);
  app.classList.toggle('very-narrow', width < VERY_NARROW_PX);
}

/**
 * Initialise responsive breakpoints.
 */
export function initLayout() {
  const app = document.querySelector('.app');
  if (!app) return;

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
