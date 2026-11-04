/** @jest-environment jsdom */

import { showMainTab, getActiveView, initTabs, onTabShown } from '../../js/ui/tabs.js';
import { initKeyboard } from '../../js/ui/keyboard.js';

function setupDom() {
  document.body.innerHTML = `
    <div class="tabs" role="tablist">
      <button class="tab" id="tab-requests" role="tab" aria-selected="true" aria-controls="requests-content">Requests</button>
      <button class="tab" id="tab-schema" role="tab" aria-selected="false" tabindex="-1" aria-controls="schema-content">Schema</button>
      <button class="tab" id="tab-breakpoints" role="tab" aria-selected="false" tabindex="-1" aria-controls="breakpoints-content">Breakpoints</button>
    </div>
    <section class="view" id="requests-content" role="tabpanel"><input id="filter-input" /></section>
    <section class="view hidden" id="schema-content" role="tabpanel"><input id="schema-search" /></section>
    <section class="view hidden" id="breakpoints-content" role="tabpanel"></section>
  `;
}

const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('main tabs', () => {
  beforeAll(() => {
    setupDom();
    initTabs();
    initKeyboard();
  });

  beforeEach(() => showMainTab('requests'));

  test('showMainTab("breakpoints") selects only that tab and panel', () => {
    showMainTab('breakpoints');
    const tab = (n) => document.getElementById(`tab-${n}`);
    const panel = (n) => document.getElementById(`${n}-content`);
    expect(tab('breakpoints').getAttribute('aria-selected')).toBe('true');
    expect(tab('breakpoints').getAttribute('tabindex')).toBe('0');
    for (const n of ['requests', 'schema']) {
      expect(tab(n).getAttribute('aria-selected')).toBe('false');
      expect(tab(n).getAttribute('tabindex')).toBe('-1');
      expect(panel(n).classList.contains('hidden')).toBe(true);
    }
    expect(panel('breakpoints').classList.contains('hidden')).toBe(false);
  });

  test('ArrowRight from Schema focuses Breakpoints', () => {
    showMainTab('schema');
    const schema = document.getElementById('tab-schema');
    schema.focus();
    key(schema, 'ArrowRight');
    expect(document.activeElement.id).toBe('tab-breakpoints');
    expect(getActiveView()).toBe('breakpoints');
  });

  test('End focuses Breakpoints and Home focuses Requests', () => {
    const requests = document.getElementById('tab-requests');
    requests.focus();
    key(requests, 'End');
    expect(document.activeElement.id).toBe('tab-breakpoints');
    key(document.activeElement, 'Home');
    expect(document.activeElement.id).toBe('tab-requests');
    expect(getActiveView()).toBe('requests');
  });

  test('getActiveView reflects clicks', () => {
    document.getElementById('tab-schema').click();
    expect(getActiveView()).toBe('schema');
    document.getElementById('tab-breakpoints').click();
    expect(getActiveView()).toBe('breakpoints');
  });

  test('onTabShown listeners are notified', () => {
    const seen = [];
    onTabShown((v) => seen.push(v));
    showMainTab('schema');
    expect(seen).toEqual(['schema']);
  });

  test('slash does not focus a filter on the breakpoints view', () => {
    showMainTab('breakpoints');
    document.activeElement.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(document.body);
  });
});
