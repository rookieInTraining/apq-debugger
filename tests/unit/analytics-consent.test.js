/**
 * @jest-environment jsdom
 */

import {
  initAnalyticsConsent,
  handleAnalyticsUpdated,
  track,
} from '../../js/ui/analytics-consent.js';
import { renderRequestDetail } from '../../js/ui/request-detail.js';
import { initCurlCopy, openCurlModal } from '../../js/ui/curl-copy.js';
import { state } from '../../js/ui/state.js';

const FIXTURE = `
  <div id="analytics-notice" class="notice hidden">
    <a href="https://example.test">What's sent</a>
    <button id="analytics-allow">Allow</button>
    <button id="analytics-decline">No thanks</button>
    <button id="analytics-dismiss" aria-label="Dismiss"></button>
  </div>
  <fieldset id="analytics-setting" class="hidden">
    <input type="checkbox" id="analytics-toggle" />
  </fieldset>
  <div id="detail-content"></div>
  <div id="curl-modal" class="hidden">
    <button class="curl-shell-option active" data-shell="bash"></button>
    <button class="curl-shell-option" data-shell="powershell"></button>
    <pre id="curl-preview"></pre>
    <button id="curl-copy-btn">Copy</button>
  </div>
`;

const $ = (id) => document.getElementById(id);
const isHidden = (id) => $(id).classList.contains('hidden');

/** Make the next getAnalyticsState / setAnalyticsConsent answer with `reply`. */
function mockSw(initial, setReply) {
  chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
    let response = null;
    if (msg.getAnalyticsState) response = { status: 'SUCCESS', ...initial };
    else if (msg.setAnalyticsConsent) {
      response = { status: 'SUCCESS', configured: true, consent: msg.setAnalyticsConsent };
      if (setReply) response = setReply(msg);
    }
    if (cb) cb(response);
  });
}

const sent = () => chrome.runtime.sendMessage.mock.calls.map(([msg]) => msg);

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('analytics consent UI', () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.lastError = null;
    Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
  });

  function init(initial) {
    mockSw(initial);
    initAnalyticsConsent();
  }

  test('unset consent shows the notice and an unchecked settings row', () => {
    init({ configured: true, consent: null });
    expect(isHidden('analytics-notice')).toBe(false);
    expect(isHidden('analytics-setting')).toBe(false);
    expect($('analytics-toggle').checked).toBe(false);
  });

  test('Allow sends granted, hides the notice and checks the box', () => {
    init({ configured: true, consent: null });
    $('analytics-allow').click();
    expect(sent()).toContainEqual({ setAnalyticsConsent: 'granted' });
    expect(isHidden('analytics-notice')).toBe(true);
    expect($('analytics-toggle').checked).toBe(true);
  });

  test.each(['analytics-decline', 'analytics-dismiss'])('%s sends denied', (id) => {
    init({ configured: true, consent: null });
    $(id).click();
    expect(sent()).toContainEqual({ setAnalyticsConsent: 'denied' });
    expect(isHidden('analytics-notice')).toBe(true);
  });

  test('denied consent keeps the notice hidden', () => {
    init({ configured: true, consent: 'denied' });
    expect(isHidden('analytics-notice')).toBe(true);
    expect(isHidden('analytics-setting')).toBe(false);
  });

  test('unconfigured hides notice and settings row, and track sends nothing', () => {
    init({ configured: false, consent: null });
    expect(isHidden('analytics-notice')).toBe(true);
    expect(isHidden('analytics-setting')).toBe(true);
    chrome.runtime.sendMessage.mockClear();
    track('panel_open');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('toggling the checkbox sends the matching consent value', () => {
    init({ configured: true, consent: 'denied' });
    $('analytics-toggle').checked = true;
    $('analytics-toggle').dispatchEvent(new Event('change'));
    expect(sent()).toContainEqual({ setAnalyticsConsent: 'granted' });
    $('analytics-toggle').checked = false;
    $('analytics-toggle').dispatchEvent(new Event('change'));
    expect(sent()).toContainEqual({ setAnalyticsConsent: 'denied' });
  });

  test('ANALYTICS_UPDATED granted hides a visible notice and checks the box', () => {
    init({ configured: true, consent: null });
    handleAnalyticsUpdated({ status: 'ANALYTICS_UPDATED', consent: 'granted' });
    expect(isHidden('analytics-notice')).toBe(true);
    expect($('analytics-toggle').checked).toBe(true);
  });

  test('track sends only while consent is granted', () => {
    init({ configured: true, consent: null });
    chrome.runtime.sendMessage.mockClear();
    track('panel_open');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    handleAnalyticsUpdated({ consent: 'granted' });
    track('copy', { what: 'hash' });
    expect(sent()).toContainEqual({ trackEvent: { name: 'copy', params: { what: 'hash' } } });
  });

  describe('copy events', () => {
    const request = {
      id: 1,
      timestamp: new Date(),
      operationName: 'GetUsers',
      type: 'full',
      url: 'https://api.example.com/graphql',
      query: 'query GetUsers { users { id } }',
      variables: null,
      hash: '',
    };

    beforeEach(() => {
      init({ configured: true, consent: 'granted' });
      state.requestHistory = [request];
      chrome.runtime.sendMessage.mockClear();
    });

    test('Copy query tracks what: query', async () => {
      renderRequestDetail(1);
      document.querySelector('[data-copy="query"]').click();
      await flush();
      expect(sent()).toContainEqual({ trackEvent: { name: 'copy', params: { what: 'query' } } });
    });

    test('cURL PowerShell copy tracks what: curl_powershell', async () => {
      initCurlCopy();
      openCurlModal(request);
      document.querySelector('[data-shell="powershell"]').click();
      $('curl-copy-btn').click();
      await flush();
      expect(sent()).toContainEqual({
        trackEvent: { name: 'copy', params: { what: 'curl_powershell' } },
      });
    });
  });
});
