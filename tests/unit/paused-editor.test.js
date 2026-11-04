/** @jest-environment jsdom */

import { state } from '../../js/ui/state.js';
import { showMainTab, initTabs } from '../../js/ui/tabs.js';
import { initKeyboard } from '../../js/ui/keyboard.js';
import { initBreakpointsView, renderPaused } from '../../js/ui/breakpoints-view.js';
import { getPendingEdits, hasEdits } from '../../js/ui/paused-editor.js';

const EDITOR_MARKUP = `
  <aside class="bp-editor hidden" id="bp-editor" aria-label="Paused request">
    <div class="bp-editor-head">
      <button type="button" class="icon-btn bp-editor-back" id="bp-editor-back" aria-label="Back to paused requests"></button>
      <h2 class="detail-title" id="bp-editor-title"></h2>
      <select class="tb-select hidden" id="bp-operation" aria-label="Operation"></select>
    </div>
    <div class="bp-subtabs" role="tablist" aria-label="Request parts">
      <button type="button" class="tab bp-subtab" id="bp-tab-query" role="tab" data-part="query" aria-selected="true" aria-controls="bp-panel-query">Query<span class="bp-edited hidden"><span class="bp-edited-dot" aria-hidden="true"></span>edited</span></button>
      <button type="button" class="tab bp-subtab" id="bp-tab-variables" role="tab" data-part="variables" aria-selected="false" tabindex="-1" aria-controls="bp-panel-variables">Variables<span class="bp-edited hidden"><span class="bp-edited-dot" aria-hidden="true"></span>edited</span></button>
      <button type="button" class="tab bp-subtab" id="bp-tab-headers" role="tab" data-part="headers" aria-selected="false" tabindex="-1" aria-controls="bp-panel-headers">Headers<span class="bp-edited hidden"><span class="bp-edited-dot" aria-hidden="true"></span>edited</span></button>
    </div>
    <div class="bp-panel" id="bp-panel-query" role="tabpanel" aria-labelledby="bp-tab-query">
      <p class="bp-note hidden" id="bp-query-note"></p>
      <textarea class="code-input" id="bp-query" spellcheck="false" aria-label="Query"></textarea>
    </div>
    <div class="bp-panel hidden" id="bp-panel-variables" role="tabpanel" aria-labelledby="bp-tab-variables">
      <textarea class="code-input" id="bp-variables" spellcheck="false" aria-label="Variables"></textarea>
    </div>
    <div class="bp-panel hidden" id="bp-panel-headers" role="tabpanel" aria-labelledby="bp-tab-headers">
      <textarea class="code-input" id="bp-headers" spellcheck="false" aria-label="Headers"></textarea>
    </div>
    <p class="bp-error hidden" id="bp-error" role="alert"></p>
    <div class="bp-actions">
      <button type="button" class="tb-btn primary" id="bp-resume">Resume this</button>
      <button type="button" class="tb-btn" id="bp-revert">Revert edits</button>
      <button type="button" class="tb-btn" id="bp-fail">Fail request</button>
      <button type="button" class="tb-btn hidden" id="bp-remove">Remove</button>
    </div>
  </aside>
`;

function setupDom() {
  document.body.innerHTML = `
    <div class="app">
      <div class="tabs" role="tablist">
        <button class="tab" id="tab-requests" role="tab" aria-selected="true">Requests</button>
        <button class="tab" id="tab-schema" role="tab" aria-selected="false" tabindex="-1">Schema</button>
        <button class="tab" id="tab-breakpoints" role="tab" aria-selected="false" tabindex="-1">Breakpoints</button>
      </div>
      <div class="status" id="debugger-status"><span class="status-dot"></span><span class="status-text">Off</span></div>
      <div class="toast-stack hidden" id="status-banner"></div>
      <section class="view" id="requests-content"><div id="request-list"></div></section>
      <section class="view hidden" id="schema-content"><div id="schema-type-list"></div></section>
      <section class="view hidden" id="breakpoints-content">
        <div class="toolbar" id="bp-toolbar" role="toolbar">
          <input type="checkbox" id="bp-debug-mode" />
          <button type="button" class="tb-btn" id="bp-pause-next" aria-pressed="false">Pause on next request</button>
          <span class="bp-hint" id="bp-pause-next-hint" hidden></span>
          <button type="button" class="tb-btn" id="bp-resume-all" disabled>Resume all</button>
        </div>
        <div class="infobar is-paused hidden" id="bp-infobar"><p class="infobar-text" id="bp-infobar-text"></p></div>
        <div class="split bp-split" id="bp-split">
          <div class="bp-lists">
            <div class="bp-paused-list" id="bp-paused-list" role="listbox" tabindex="0" hidden></div>
            <div class="empty-state bp-empty" id="bp-empty"><p id="bp-empty-off"></p></div>
            <form id="bp-list" class="bp-list" role="group"></form>
            <button type="button" class="tb-btn" id="bp-add">Add breakpoint</button>
          </div>
          ${EDITOR_MARKUP}
        </div>
      </section>
    </div>
  `;
}

/**
 * @param {string} id
 * @param {object} [overrides]
 */
function held(id, overrides = {}) {
  return {
    id,
    networkId: `n-${id}`,
    tabId: 123,
    url: 'https://example.com/graphql',
    method: 'POST',
    heldAt: 1,
    reason: 'breakpoint',
    state: 'paused',
    body: {},
    rawHeaders: { 'content-type': 'application/json', authorization: 'Bearer a' },
    operations: [
      {
        index: 0,
        operationName: `Op${id}`,
        query: `query Op${id} { a }`,
        querySource: 'request',
        variables: { id: 1 },
        hash: '',
        isHashOnly: false,
      },
    ],
    ...overrides,
  };
}

function twoOps(id) {
  return held(id, {
    body: [{}, {}],
    operations: [
      {
        index: 0,
        operationName: 'GetCart',
        query: 'query GetCart { cart }',
        querySource: 'request',
        variables: null,
        hash: '',
        isHashOnly: false,
      },
      {
        index: 1,
        operationName: 'GetUser',
        query: 'query GetUser { user }',
        querySource: 'request',
        variables: { id: 'u1' },
        hash: '',
        isHashOnly: false,
      },
    ],
  });
}

/** Results the mocked worker answers resumePaused / failPaused with. */
let results;

function mockWorker() {
  chrome.runtime.sendMessage = jest.fn((msg, cb) => {
    let response = { status: 'SUCCESS' };
    if (msg.getBreakpointState) response = { status: 'SUCCESS', breakpoints: [], paused: [] };
    else if (msg.resumePaused !== undefined)
      response = { status: 'SUCCESS', result: results.resume };
    else if (msg.failPaused !== undefined) response = { status: 'SUCCESS', result: results.fail };
    if (cb) cb(response);
  });
}

const byId = (id) => document.getElementById(id);
const messages = () => chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
const actionMessages = () =>
  messages().filter((m) => 'resumePaused' in m || 'failPaused' in m || 'resumeAllPaused' in m);
const toasts = () =>
  Array.from(document.querySelectorAll('#status-banner .toast')).map((t) => ({
    text: t.querySelector('.toast-text').textContent,
    warning: t.classList.contains('toast--warning'),
  }));
const marker = (part) => byId(`bp-tab-${part}`).querySelector('.bp-edited');
const isEdited = (part) => !marker(part).classList.contains('hidden');

/**
 * Type into a textarea the way the user would.
 * @param {string} id
 * @param {string} value
 */
function type(id, value) {
  const field = byId(id);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

const keydown = (target, key) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

let keyboardReady = false;

function setup(paused = [held('1')]) {
  setupDom();
  results = { resume: 'sent', fail: 'failed' };
  state.isDebuggerActive = true;
  state.paused = [];
  state.breakpoints = [];
  state.selectedPausedId = null;
  mockWorker();
  initTabs();
  if (!keyboardReady) {
    initKeyboard();
    keyboardReady = true;
  }
  initBreakpointsView();
  renderPaused(paused, false);
  showMainTab('breakpoints');
  chrome.runtime.sendMessage.mockClear();
}

afterEach(() => {
  renderPaused([], false);
});

describe('paused editor: rendering', () => {
  test('shows the query, pretty-printed variables and headers as a JSON object', () => {
    setup();
    expect(byId('bp-editor').classList.contains('hidden')).toBe(false);
    expect(byId('bp-query').value).toBe('query Op1 { a }');
    expect(byId('bp-variables').value).toBe(JSON.stringify({ id: 1 }, null, 2));
    expect(byId('bp-headers').value).toBe(
      JSON.stringify({ 'content-type': 'application/json', authorization: 'Bearer a' }, null, 2)
    );
    for (const id of ['bp-query', 'bp-variables', 'bp-headers']) {
      expect(byId(id).getAttribute('spellcheck')).toBe('false');
      expect(byId(id).readOnly).toBe(false);
    }
    expect(byId('bp-query-note').classList.contains('hidden')).toBe(true);
    expect(byId('bp-operation').classList.contains('hidden')).toBe(true);
  });

  test('null variables show as an empty object', () => {
    const item = held('1');
    item.operations[0].variables = null;
    setup([item]);
    expect(byId('bp-variables').value).toBe('{}');
  });

  test('a query not in the registry is read-only with a note', () => {
    const item = held('1');
    item.operations[0].query = '';
    item.operations[0].querySource = 'none';
    setup([item]);
    expect(byId('bp-query').readOnly).toBe(true);
    expect(byId('bp-query-note').classList.contains('hidden')).toBe(false);
    expect(byId('bp-query-note').textContent).toBe(
      'Not in registry — the query text is unknown. You can still edit variables and headers.'
    );
    expect(byId('bp-variables').readOnly).toBe(false);
  });

  test('a query filled from the registry says so and stays editable', () => {
    const item = held('1');
    item.operations[0].querySource = 'registry';
    setup([item]);
    expect(byId('bp-query').readOnly).toBe(false);
    expect(byId('bp-query-note').textContent).toBe(
      'Filled from the hash registry. Edit it to send the full query instead of the hash.'
    );
  });

  test('a batched request offers an operation select that switches the fields', () => {
    setup([twoOps('1')]);
    const select = byId('bp-operation');
    expect(select.classList.contains('hidden')).toBe(false);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['GetCart', 'GetUser']);
    expect(byId('bp-query').value).toBe('query GetCart { cart }');
    expect(byId('bp-variables').value).toBe('{}');

    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(byId('bp-query').value).toBe('query GetUser { user }');
    expect(byId('bp-variables').value).toBe(JSON.stringify({ id: 'u1' }, null, 2));
  });

  test('sub-tabs form a tablist operated with arrow keys', () => {
    setup();
    const tabs = Array.from(document.querySelectorAll('.bp-subtabs [role="tab"]'));
    expect(tabs.map((t) => t.dataset.part)).toEqual(['query', 'variables', 'headers']);
    tabs[0].focus();
    keydown(tabs[0], 'ArrowRight');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    expect(byId('bp-panel-variables').classList.contains('hidden')).toBe(false);
    expect(byId('bp-panel-query').classList.contains('hidden')).toBe(true);
    keydown(tabs[1], 'End');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    tabs[0].click();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[2].tabIndex).toBe(-1);
  });
});

describe('paused editor: edited markers', () => {
  test('editing a part marks its tab with the word edited; restoring the text clears it', () => {
    setup();
    expect(isEdited('variables')).toBe(false);
    type('bp-variables', '{"id": 2}');
    expect(isEdited('variables')).toBe(true);
    expect(marker('variables').textContent).toBe('edited');
    expect(marker('variables').querySelector('.bp-edited-dot')).not.toBeNull();
    expect(isEdited('query')).toBe(false);
    expect(hasEdits('1')).toBe(true);

    type('bp-variables', JSON.stringify({ id: 1 }, null, 2));
    expect(isEdited('variables')).toBe(false);
    expect(hasEdits('1')).toBe(false);
  });

  test('Revert edits restores the originals and clears every marker', () => {
    setup();
    type('bp-query', 'query Changed { b }');
    type('bp-headers', '{}');
    byId('bp-revert').click();
    expect(byId('bp-query').value).toBe('query Op1 { a }');
    expect(byId('bp-headers').value).toContain('Bearer a');
    expect(isEdited('query')).toBe(false);
    expect(isEdited('headers')).toBe(false);
    expect(hasEdits('1')).toBe(false);
  });

  test('edits are kept per held request when switching between them', () => {
    setup([held('1'), held('2')]);
    type('bp-query', 'query Mine { b }');
    document.querySelectorAll('#bp-paused-list [role="option"]')[1].click();
    expect(byId('bp-query').value).toBe('query Op2 { a }');
    expect(isEdited('query')).toBe(false);
    document.querySelectorAll('#bp-paused-list [role="option"]')[0].click();
    expect(byId('bp-query').value).toBe('query Mine { b }');
    expect(isEdited('query')).toBe(true);
  });

  test('a queue update keeps edits and does not re-render the field being typed in', () => {
    setup([held('1')]);
    type('bp-variables', '{"id": 2}');
    // mid-keystroke: the field holds text the editor has not seen yet
    byId('bp-variables').value = '{"id": 23';
    const field = byId('bp-variables');
    renderPaused([held('1'), held('2')], false);
    expect(state.selectedPausedId).toBe('1');
    expect(byId('bp-variables')).toBe(field);
    expect(field.value).toBe('{"id": 23');
    expect(hasEdits('1')).toBe(true);
  });

  test('the selected request turning cancelled re-renders it read-only, keeping edits', () => {
    setup([held('1')]);
    type('bp-query', 'query Mine { b }');
    renderPaused([held('1', { state: 'cancelled' })], false);
    expect(byId('bp-query').readOnly).toBe(true);
    expect(byId('bp-query').value).toBe('query Mine { b }');
  });
});

describe('paused editor: Resume this', () => {
  test('without edits sends resumePaused with no edits', () => {
    setup();
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([{ resumePaused: '1', tabId: 123 }]);
  });

  test('sends only the changed parts', () => {
    setup([twoOps('1')]);
    const select = byId('bp-operation');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    type('bp-variables', '{"id": "u2"}');
    type('bp-headers', '{"content-type": "application/json", "authorization": "Bearer b"}');
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([
      {
        resumePaused: '1',
        tabId: 123,
        edits: {
          operations: [{ index: 1, variables: { id: 'u2' } }],
          headers: { 'content-type': 'application/json', authorization: 'Bearer b' },
        },
      },
    ]);
  });

  test('an edited query is sent with its operation index', () => {
    setup();
    type('bp-query', 'query Op1 { a b }');
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([
      {
        resumePaused: '1',
        tabId: 123,
        edits: { operations: [{ index: 0, query: 'query Op1 { a b }' }] },
      },
    ]);
  });

  test('getPendingEdits returns the changed parts, or null without edits', () => {
    setup();
    expect(getPendingEdits('1')).toBeNull();
    type('bp-variables', '{"id": 5}');
    expect(getPendingEdits('1')).toEqual({ operations: [{ index: 0, variables: { id: 5 } }] });
  });

  test('invalid variables JSON shows the error, focuses the field and sends nothing', () => {
    setup();
    type('bp-variables', '{"id": ');
    byId('bp-tab-query').click();
    let parseMessage;
    try {
      JSON.parse('{"id": ');
    } catch (e) {
      parseMessage = e.message;
    }
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([]);
    expect(byId('bp-error').classList.contains('hidden')).toBe(false);
    expect(byId('bp-error').getAttribute('role')).toBe('alert');
    expect(byId('bp-error').textContent).toBe(`Variables aren't valid JSON: ${parseMessage}`);
    expect(byId('bp-tab-variables').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(byId('bp-variables'));
  });

  test('invalid headers JSON shows the error and sends nothing', () => {
    setup();
    type('bp-headers', 'nope');
    let parseMessage;
    try {
      JSON.parse('nope');
    } catch (e) {
      parseMessage = e.message;
    }
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([]);
    expect(byId('bp-error').textContent).toBe(`Headers aren't valid JSON: ${parseMessage}`);
    expect(document.activeElement).toBe(byId('bp-headers'));
  });

  test.each([['{"x-count": 1}'], ['["a"]'], ['"text"'], ['null']])(
    'headers %s must be an object of strings',
    (text) => {
      setup();
      type('bp-headers', text);
      byId('bp-resume').click();
      expect(actionMessages()).toEqual([]);
      expect(byId('bp-error').textContent).toBe('Headers must be a JSON object of strings.');
    }
  );

  test.each([['x header'], ['x:y'], [''], ['x-é']])(
    'an invalid header name %j shows the inline error, focuses Headers and sends nothing',
    (name) => {
      setup();
      type('bp-headers', JSON.stringify({ 'content-type': 'application/json', [name]: 'v' }));
      byId('bp-resume').click();
      expect(actionMessages()).toEqual([]);
      expect(byId('bp-error').textContent).toBe(`Header name "${name}" isn't valid.`);
      expect(byId('bp-error').classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(byId('bp-headers'));
    }
  );

  test.each([['a\r\nx-injected: 1'], ['a\nb'], ['a\rb']])(
    'a header value with a line break (%j) shows the inline error and sends nothing',
    (value) => {
      setup();
      type('bp-headers', JSON.stringify({ authorization: value }));
      byId('bp-resume').click();
      expect(actionMessages()).toEqual([]);
      expect(byId('bp-error').textContent).toBe(
        'Header "authorization" has a line break in its value.'
      );
      expect(document.activeElement).toBe(byId('bp-headers'));
    }
  );

  test('token punctuation is a valid header name', () => {
    setup();
    type('bp-headers', JSON.stringify({ "x-a!#$%&'*+.^_`|~1": 'v' }));
    byId('bp-resume').click();
    expect(actionMessages()).toEqual([
      { resumePaused: '1', tabId: 123, edits: { headers: { "x-a!#$%&'*+.^_`|~1": 'v' } } },
    ]);
  });

  test('a cancelled result shows a warning toast', () => {
    setup();
    results.resume = 'cancelled';
    byId('bp-resume').click();
    expect(toasts()).toEqual([
      { text: 'The page cancelled this request before it was resumed.', warning: true },
    ]);
  });

  test('fixing the JSON clears the error', () => {
    setup();
    type('bp-variables', '{');
    byId('bp-resume').click();
    type('bp-variables', '{"id": 3}');
    expect(byId('bp-error').classList.contains('hidden')).toBe(true);
  });
});

describe('paused editor: Fail and Remove', () => {
  test('Fail request sends failPaused', () => {
    setup();
    byId('bp-fail').click();
    expect(actionMessages()).toEqual([{ failPaused: '1', tabId: 123 }]);
  });

  test('a cancelled request is read-only and offers only Remove', () => {
    setup([held('1', { state: 'cancelled' })]);
    for (const id of ['bp-query', 'bp-variables', 'bp-headers']) {
      expect(byId(id).readOnly).toBe(true);
    }
    for (const id of ['bp-resume', 'bp-revert', 'bp-fail']) {
      expect(byId(id).classList.contains('hidden')).toBe(true);
    }
    expect(byId('bp-remove').classList.contains('hidden')).toBe(false);
    results.fail = 'cancelled';
    byId('bp-remove').click();
    expect(actionMessages()).toEqual([{ failPaused: '1', tabId: 123 }]);
    expect(toasts()).toEqual([]);
  });

  test('a paused request offers the three actions, not Remove', () => {
    setup();
    for (const id of ['bp-resume', 'bp-revert', 'bp-fail']) {
      expect(byId(id).classList.contains('hidden')).toBe(false);
    }
    expect(byId('bp-remove').classList.contains('hidden')).toBe(true);
  });
});

describe('paused editor: Resume all', () => {
  const pressF8 = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));

  test.each([
    ['the Resume all button', () => byId('bp-resume-all').click()],
    ['F8', pressF8],
  ])('%s sends each edited request with its edits, then resumeAllPaused', (_, trigger) => {
    setup([held('1'), held('2'), held('3')]);
    type('bp-variables', '{"id": 9}');
    document.querySelectorAll('#bp-paused-list [role="option"]')[2].click();
    type('bp-query', 'query Op3 { z }');
    trigger();
    expect(actionMessages()).toEqual([
      {
        resumePaused: '1',
        tabId: 123,
        edits: { operations: [{ index: 0, variables: { id: 9 } }] },
      },
      {
        resumePaused: '3',
        tabId: 123,
        edits: { operations: [{ index: 0, query: 'query Op3 { z }' }] },
      },
      { resumeAllPaused: true, tabId: 123 },
    ]);
  });

  test('an edited request with invalid JSON is selected, shows its error and blocks all', () => {
    setup([held('1'), held('2')]);
    document.querySelectorAll('#bp-paused-list [role="option"]')[1].click();
    type('bp-headers', '{bad');
    document.querySelectorAll('#bp-paused-list [role="option"]')[0].click();
    type('bp-variables', '{"id": 4}');
    byId('bp-resume-all').click();
    expect(actionMessages()).toEqual([]);
    expect(state.selectedPausedId).toBe('2');
    expect(byId('bp-error').textContent).toMatch(/^Headers aren't valid JSON: /);
    expect(document.activeElement).toBe(byId('bp-headers'));
  });

  test('cancelled requests are left out of Resume all', () => {
    setup([held('1'), held('2', { state: 'cancelled' })]);
    document.querySelectorAll('#bp-paused-list [role="option"]')[1].click();
    // read-only, so nothing can be typed; Resume all sends only resumeAllPaused
    byId('bp-resume-all').click();
    expect(actionMessages()).toEqual([{ resumeAllPaused: true, tabId: 123 }]);
  });
});

describe('paused editor: going back to the list', () => {
  test('the back button clears the selection and returns focus to the list', () => {
    setup([held('1'), held('2')]);
    const back = byId('bp-editor-back');
    expect(back.getAttribute('aria-label')).toBe('Back to paused requests');
    back.click();
    expect(state.selectedPausedId).toBeNull();
    expect(byId('bp-editor').classList.contains('hidden')).toBe(true);
    expect(byId('bp-paused-list').contains(document.activeElement)).toBe(true);
  });

  test('a later queue update without new requests does not reopen the editor', () => {
    setup([held('1'), held('2')]);
    byId('bp-editor-back').click();
    renderPaused([held('1'), held('2', { state: 'cancelled' })], false);
    expect(state.selectedPausedId).toBeNull();
    expect(byId('bp-editor').classList.contains('hidden')).toBe(true);
  });

  test('Escape inside the editor goes back, but not while typing in a field', () => {
    setup();
    keydown(byId('bp-variables'), 'Escape');
    expect(state.selectedPausedId).toBe('1');
    keydown(byId('bp-resume'), 'Escape');
    expect(state.selectedPausedId).toBeNull();
    expect(byId('bp-editor').classList.contains('hidden')).toBe(true);
  });
});
