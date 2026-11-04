/** @jest-environment jsdom */

import { state } from '../../js/ui/state.js';
import { showMainTab, getActiveView, initTabs } from '../../js/ui/tabs.js';
import { initKeyboard } from '../../js/ui/keyboard.js';
import { updateDebuggerStatus } from '../../js/ui/status.js';
import {
  initBreakpointsView,
  renderPaused,
  handlePausedMessage,
  onPausedSelected,
} from '../../js/ui/breakpoints-view.js';
import { connectPanelPort } from '../../js/ui/panel-port.js';

function setupDom() {
  document.body.innerHTML = `
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
        <label class="check"><input type="checkbox" id="bp-debug-mode" /> Debug mode</label>
        <button type="button" class="tb-btn" id="bp-pause-next" aria-pressed="false">Pause on next request</button>
        <span class="bp-hint" id="bp-pause-next-hint" hidden>Waiting for the next request…</span>
        <button type="button" class="tb-btn" id="bp-resume-all" title="Resume all (F8)" disabled>Resume all</button>
      </div>
      <div class="infobar is-paused hidden" id="bp-infobar"><p class="infobar-text" id="bp-infobar-text"></p></div>
      <div class="split bp-split" id="bp-split">
        <div class="bp-lists">
          <div class="bp-paused-list" id="bp-paused-list" role="listbox" aria-label="Paused requests" tabindex="0" hidden></div>
          <div class="empty-state bp-empty" id="bp-empty">
            <p class="empty-title">No paused requests</p>
            <p class="empty-desc">Add an operation name below and turn on debug mode.</p>
            <p class="empty-desc" id="bp-empty-off">Start interception on the Requests tab first.</p>
          </div>
          <form id="bp-list" class="bp-list" role="group"></form>
          <button type="button" class="tb-btn" id="bp-add">Add breakpoint</button>
        </div>
        <aside class="bp-editor hidden" id="bp-editor"></aside>
      </div>
    </section>
  `;
}

/** @param {string} id @param {string} name @param {'paused'|'cancelled'} [heldState] */
function held(id, name, heldState = 'paused') {
  return {
    id,
    networkId: `n-${id}`,
    tabId: 123,
    url: 'https://example.com/graphql',
    method: 'POST',
    heldAt: 1,
    reason: 'breakpoint',
    state: heldState,
    body: {},
    rawHeaders: {},
    operations: [
      {
        index: 0,
        operationName: name,
        query: '',
        querySource: 'request',
        variables: null,
        hash: '',
        isHashOnly: false,
      },
    ],
  };
}

let initialState;

function mockWorker() {
  chrome.runtime.sendMessage = jest.fn((msg, cb) => {
    let response = { status: 'SUCCESS' };
    if (msg.getBreakpointState) response = { status: 'SUCCESS', ...initialState };
    else if (msg.setBreakpoints) response = { status: 'SUCCESS', breakpoints: msg.setBreakpoints };
    else if (msg.setDebugMode !== undefined || msg.setPauseNext !== undefined) {
      response = {
        status: 'SUCCESS',
        debugMode: msg.setDebugMode ?? state.debugMode,
        pauseNext: msg.setPauseNext ?? state.pauseNext,
      };
    }
    if (cb) cb(response);
  });
}

const sent = (key) =>
  chrome.runtime.sendMessage.mock.calls.map((c) => c[0]).filter((m) => key in m);
const byId = (id) => document.getElementById(id);
const statusText = () => document.querySelector('#debugger-status .status-text').textContent;

let keyboardReady = false;

function setup({ breakpoints = [], paused = [], debugMode = false, pauseNext = false } = {}) {
  setupDom();
  state.isDebuggerActive = true;
  state.passiveMode = false;
  state.paused = [];
  state.breakpoints = [];
  state.selectedPausedId = null;
  initialState = { breakpoints, paused, debugMode, pauseNext };
  mockWorker();
  initTabs();
  if (!keyboardReady) {
    // the global keydown listener lives on document and survives DOM resets
    initKeyboard();
    keyboardReady = true;
  }
  showMainTab('requests');
  updateDebuggerStatus('Intercepting', 'active');
  initBreakpointsView();
}

afterEach(() => {
  renderPaused([], false);
});

describe('breakpoints view: initial state', () => {
  test('requests getBreakpointState for the inspected tab and renders it', () => {
    setup({ breakpoints: [{ name: 'GetCart', enabled: true }], paused: [held('1', 'GetCart')] });

    expect(sent('getBreakpointState')).toEqual([{ getBreakpointState: true, tabId: 123 }]);
    const names = Array.from(document.querySelectorAll('#bp-list .bp-name')).map((i) => i.value);
    expect(names).toEqual(['GetCart']);
    const rows = document.querySelectorAll('#bp-paused-list [role="option"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('GetCart');
    expect(state.selectedPausedId).toBe('1');
  });

  test('empty queue shows the empty state, with the interception hint only when off', () => {
    setup();
    expect(byId('bp-empty').classList.contains('hidden')).toBe(false);
    expect(byId('bp-empty-off').classList.contains('hidden')).toBe(true);

    state.isDebuggerActive = false;
    showMainTab('breakpoints');
    expect(byId('bp-empty-off').classList.contains('hidden')).toBe(false);
  });
});

describe('breakpoint list', () => {
  test('typing a name and leaving the field saves the trimmed list', () => {
    setup({ breakpoints: [{ name: 'GetCart', enabled: true }] });
    byId('bp-add').click();
    const inputs = document.querySelectorAll('#bp-list .bp-name');
    const input = inputs[inputs.length - 1];
    input.value = '  AddToCart  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));

    expect(sent('setBreakpoints').pop()).toEqual({
      setBreakpoints: [
        { name: 'GetCart', enabled: true },
        { name: 'AddToCart', enabled: true },
      ],
    });
    const toggles = document.querySelectorAll('#bp-list .bp-enable');
    expect(toggles[1].getAttribute('aria-label')).toBe('Enable breakpoint AddToCart');
  });

  test('unchecking the enable checkbox saves enabled: false', () => {
    setup({ breakpoints: [{ name: 'GetCart', enabled: true }] });
    const toggle = document.querySelector('#bp-list .bp-enable');
    expect(toggle.getAttribute('aria-label')).toBe('Enable breakpoint GetCart');
    toggle.click();

    expect(sent('setBreakpoints').pop()).toEqual({
      setBreakpoints: [{ name: 'GetCart', enabled: false }],
    });
  });

  test('removing a row saves the list without it', () => {
    setup({
      breakpoints: [
        { name: 'GetCart', enabled: true },
        { name: 'GetUser', enabled: false },
      ],
    });
    document.querySelector('#bp-list .bp-remove').click();
    expect(sent('setBreakpoints').pop()).toEqual({
      setBreakpoints: [{ name: 'GetUser', enabled: false }],
    });
  });

  test('leaving a field unchanged sends nothing', () => {
    setup({ breakpoints: [{ name: 'GetCart', enabled: true }] });
    document.querySelector('#bp-list .bp-name').dispatchEvent(new FocusEvent('blur'));
    expect(sent('setBreakpoints')).toHaveLength(0);
  });
});

describe('toolbar', () => {
  test('debug mode checkbox sends setDebugMode for the tab', () => {
    setup();
    byId('bp-debug-mode').click();
    expect(sent('setDebugMode').pop()).toEqual({ setDebugMode: true, tabId: 123 });
    expect(state.debugMode).toBe(true);
  });

  test('pause on next sends setPauseNext, presses the button and shows the hint', () => {
    setup();
    const button = byId('bp-pause-next');
    button.click();
    expect(sent('setPauseNext').pop()).toEqual({ setPauseNext: true, tabId: 123 });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(byId('bp-pause-next-hint').hidden).toBe(false);
    expect(byId('bp-pause-next-hint').textContent).toBe('Waiting for the next request…');
  });

  test('a failed pause-next request reverts the button', () => {
    setup();
    chrome.runtime.sendMessage = jest.fn((msg, cb) => cb && cb({ status: 'ERROR' }));
    byId('bp-pause-next').click();
    expect(byId('bp-pause-next').getAttribute('aria-pressed')).toBe('false');
    expect(byId('bp-pause-next-hint').hidden).toBe(true);
  });
});

describe('paused updates', () => {
  test('one paused request switches to the tab, sets infobar and status, selects it', () => {
    setup();
    const seen = [];
    onPausedSelected((item) => seen.push(item && item.id));
    expect(getActiveView()).toBe('requests');

    handlePausedMessage({
      status: 'PAUSED_UPDATED',
      tabId: 123,
      paused: [held('7', 'GetCart')],
      pauseNext: false,
    });

    expect(getActiveView()).toBe('breakpoints');
    expect(byId('bp-infobar').classList.contains('hidden')).toBe(false);
    expect(byId('bp-infobar-text').textContent).toBe('Paused on GetCart');
    expect(statusText()).toBe('Paused');
    expect(byId('debugger-status').classList.contains('paused')).toBe(true);
    expect(state.selectedPausedId).toBe('7');
    const row = document.querySelector('#bp-paused-list [role="option"]');
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.textContent).toContain('Paused');
    expect(byId('bp-editor').classList.contains('hidden')).toBe(false);
    expect(byId('bp-resume-all').disabled).toBe(false);
    expect(byId('bp-empty').classList.contains('hidden')).toBe(true);
    expect(seen).toContain('7');
  });

  test('two paused requests say how many are waiting', () => {
    setup();
    renderPaused([held('1', 'GetCart'), held('2', 'GetUser')], false);
    expect(byId('bp-infobar-text').textContent).toBe('Paused · 2 requests waiting');
  });

  test('an anonymous operation is named as such', () => {
    setup();
    renderPaused([held('1', '')], false);
    expect(byId('bp-infobar-text').textContent).toBe('Paused on anonymous operation');
  });

  test('emptying the queue hides the infobar and restores the session word', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    expect(statusText()).toBe('Paused');

    renderPaused([], false);
    expect(byId('bp-infobar').classList.contains('hidden')).toBe(true);
    expect(statusText()).toBe('Intercepting');
    expect(byId('debugger-status').classList.contains('active')).toBe(true);
    expect(state.selectedPausedId).toBeNull();
    expect(byId('bp-editor').classList.contains('hidden')).toBe(true);
  });

  test('restores Passive when interception is off and passive mode is on', () => {
    setup();
    state.isDebuggerActive = false;
    state.passiveMode = true;
    renderPaused([held('1', 'GetCart')], false);
    renderPaused([], false);
    expect(statusText()).toBe('Passive');
  });

  test('session words do not replace Paused while requests are held', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    updateDebuggerStatus('Intercepting', 'active');
    expect(statusText()).toBe('Paused');
  });

  test('a request cancelled by the page says so', () => {
    setup();
    renderPaused([held('1', 'GetCart', 'cancelled')], false);
    const row = document.querySelector('#bp-paused-list [role="option"]');
    expect(row.textContent).toContain('Cancelled by page');
    expect(row.classList.contains('is-cancelled')).toBe(true);
  });

  test('a cancelled request after a paused one is not named', () => {
    setup();
    renderPaused([held('1', 'GetCart'), held('2', 'GetUser', 'cancelled')], false);
    expect(byId('bp-infobar-text').textContent).toBe('Paused on GetCart');
  });

  test('a cancelled request before a paused one is not named and not selected', () => {
    setup();
    renderPaused([held('1', 'GetCart', 'cancelled'), held('2', 'GetUser')], false);
    expect(byId('bp-infobar-text').textContent).toBe('Paused on GetUser');
    expect(state.selectedPausedId).toBe('2');
  });

  test('only paused requests count as waiting', () => {
    setup();
    renderPaused(
      [held('1', 'GetCart'), held('2', 'GetUser', 'cancelled'), held('3', 'AddToCart')],
      false
    );
    expect(byId('bp-infobar-text').textContent).toBe('Paused · 2 requests waiting');
  });

  test('cancelled-only queue: no infobar, session word restored, nothing to resume', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    expect(statusText()).toBe('Paused');

    renderPaused([held('1', 'GetCart', 'cancelled')], false);
    expect(byId('bp-infobar').classList.contains('hidden')).toBe(true);
    expect(statusText()).toBe('Intercepting');
    expect(byId('bp-resume-all').disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
    expect(sent('resumeAllPaused')).toHaveLength(0);
    expect(document.querySelectorAll('#bp-paused-list [role="option"]')).toHaveLength(1);
  });

  test('pauseNext from the update drives the toolbar', () => {
    setup();
    renderPaused([], true);
    expect(byId('bp-pause-next').getAttribute('aria-pressed')).toBe('true');
    renderPaused([], false);
    expect(byId('bp-pause-next').getAttribute('aria-pressed')).toBe('false');
  });

  test('updates for another tab are ignored', () => {
    setup();
    handlePausedMessage({
      status: 'PAUSED_UPDATED',
      tabId: 999,
      paused: [held('1', 'GetCart')],
      pauseNext: false,
    });
    expect(state.paused).toEqual([]);
    expect(getActiveView()).toBe('requests');
    expect(statusText()).toBe('Intercepting');
  });

  test('a later update keeps the selection and does not pull the user back', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    showMainTab('requests');
    renderPaused([held('1', 'GetCart', 'cancelled')], false);
    expect(getActiveView()).toBe('requests');
    renderPaused([held('1', 'GetCart'), held('2', 'GetUser')], false);
    expect(getActiveView()).toBe('breakpoints');
    expect(state.selectedPausedId).toBe('1');
  });

  test('clicking a row selects it', () => {
    setup();
    renderPaused([held('1', 'GetCart'), held('2', 'GetUser')], false);
    document.querySelectorAll('#bp-paused-list [role="option"]')[1].click();
    expect(state.selectedPausedId).toBe('2');
  });

  test('arrow keys move the selection through the paused list', () => {
    setup();
    renderPaused([held('1', 'GetCart'), held('2', 'GetUser')], false);
    const list = byId('bp-paused-list');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(state.selectedPausedId).toBe('2');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(state.selectedPausedId).toBe('1');
  });
});

describe('resume all', () => {
  const pressF8 = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));

  test('F8 with paused requests sends resumeAllPaused', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    pressF8();
    expect(sent('resumeAllPaused')).toEqual([{ resumeAllPaused: true, tabId: 123 }]);
  });

  test('F8 with nothing paused does nothing', () => {
    setup();
    pressF8();
    expect(sent('resumeAllPaused')).toHaveLength(0);
  });

  test('the Resume all button sends resumeAllPaused', () => {
    setup();
    renderPaused([held('1', 'GetCart')], false);
    byId('bp-resume-all').click();
    expect(sent('resumeAllPaused')).toEqual([{ resumeAllPaused: true, tabId: 123 }]);
  });
});

describe('panel port', () => {
  test('connects with the tab name and reconnects 500 ms after a disconnect', () => {
    jest.useFakeTimers();
    const ports = [];
    chrome.runtime.connect = jest.fn(({ name }) => {
      const port = {
        name,
        disconnectListeners: [],
        onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
        onMessage: { addListener: jest.fn() },
        postMessage: jest.fn(),
        disconnect: jest.fn(),
      };
      ports.push(port);
      return port;
    });

    connectPanelPort(123);
    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'gql-panel:123' });

    ports[0].disconnectListeners.forEach((fn) => fn());
    jest.advanceTimersByTime(499);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(ports[1].name).toBe('gql-panel:123');
    jest.useRealTimers();
  });
});
