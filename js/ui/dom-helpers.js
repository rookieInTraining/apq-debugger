/**
 * Shared DOM utility functions for the DevTools panel.
 * @module ui/dom-helpers
 */

/**
 * Get a DOM element by ID, logging an error if not found.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`Element with id '${id}' not found`);
  }
  return element;
}

/**
 * Get all pattern input elements currently in the DOM.
 * @returns {HTMLInputElement[]}
 */
export function getPatternInputs() {
  return Array.from(document.querySelectorAll('.urlPattern'));
}

/**
 * Read non-empty, trimmed values from all pattern input fields.
 * @returns {string[]}
 */
export function getPatternsFromForm() {
  return getPatternInputs()
    .map((input) => (input ? input.value.trim() : ''))
    .filter((value) => value.length > 0);
}

/**
 * Escape a string for safe insertion as HTML text content.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Truncate a URL for display, keeping the rightmost characters.
 * @param {string} url
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateUrl(url, maxLength = 40) {
  if (url.length <= maxLength) return url;
  return '...' + url.slice(-maxLength);
}
