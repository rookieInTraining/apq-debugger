/**
 * @jest-environment jsdom
 */

import {
  buildGraphQLBody,
  getReplayHeaders,
  toBashCurl,
  toPowerShellCurl,
  openCurlModal,
  initCurlCopy,
} from '../../js/ui/curl-copy.js';
import { normalizeRequestHeaders } from '../../js/sw/interceptor.js';

describe('curl-copy', () => {
  const sampleRequest = {
    url: 'https://api.example.com/graphql',
    operationName: 'GetUsers',
    query: 'query GetUsers { users { id name } }',
    variables: { limit: 10 },
    hash: 'abc123hash',
  };

  describe('buildGraphQLBody', () => {
    test('should include query, variables, operationName, and APQ hash', () => {
      const body = buildGraphQLBody(sampleRequest);
      expect(body).toEqual({
        operationName: 'GetUsers',
        query: 'query GetUsers { users { id name } }',
        variables: { limit: 10 },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: 'abc123hash' },
        },
      });
    });

    test('should build APQ-only body from hash', () => {
      const body = buildGraphQLBody({
        url: 'https://x.com/gql',
        hash: 'only-hash',
        type: 'apq',
      });
      expect(body.extensions.persistedQuery.sha256Hash).toBe('only-hash');
      expect(body.query).toBeUndefined();
    });
  });

  describe('toBashCurl', () => {
    test('should produce a multi-line curl with POST and JSON body', () => {
      const body = buildGraphQLBody(sampleRequest);
      const curl = toBashCurl(sampleRequest.url, body);

      expect(curl).toContain("curl 'https://api.example.com/graphql'");
      expect(curl).toContain('-X POST');
      expect(curl).toContain('--data-raw');
      expect(curl).toContain('GetUsers');
    });

    test('should escape single quotes in bash strings', () => {
      const curl = toBashCurl('https://x.com/gql', { query: "query { field(value: 'a') }" });
      expect(curl).toContain("'\\''");
    });

    test('should include captured request headers', () => {
      const headers = [
        { name: 'Cookie', value: 'session=abc' },
        { name: 'client-info', value: 'web' },
      ];
      const curl = toBashCurl('https://x.com/gql', { query: '{}' }, headers);

      expect(curl).toContain("-H 'Cookie: session=abc'");
      expect(curl).toContain("-H 'client-info: web'");
    });
  });

  describe('toPowerShellCurl', () => {
    test('should produce Invoke-RestMethod with here-string body', () => {
      const body = buildGraphQLBody(sampleRequest);
      const ps = toPowerShellCurl(sampleRequest.url, body);

      expect(ps).toContain("$body = @'");
      expect(ps).toContain('Invoke-RestMethod');
      expect(ps).toContain('-Uri "https://api.example.com/graphql"');
      expect(ps).toContain('-Body $body');
    });

    test('should emit a headers hashtable when headers were captured', () => {
      const headers = [{ name: 'Cookie', value: 'a=b' }];
      const ps = toPowerShellCurl('https://x.com/gql', { query: '{}' }, headers);

      expect(ps).toContain('$headers = @{');
      expect(ps).toContain("'Cookie' = 'a=b'");
      expect(ps).toContain('-Headers $headers');
    });
  });

  describe('getReplayHeaders', () => {
    test('should return stored header pairs from a request', () => {
      expect(
        getReplayHeaders({
          headers: [{ name: 'User-Agent', value: 'Mozilla/5.0' }],
        })
      ).toEqual([{ name: 'User-Agent', value: 'Mozilla/5.0' }]);
    });
  });

  describe('modal interactions', () => {
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      document.body.innerHTML = `
        <div class="modal hidden" id="curl-modal">
          <div class="modal-backdrop"></div>
          <div class="modal-panel">
            <button id="curl-modal-close"></button>
            <div class="modal-options">
              <button class="curl-shell-option active" data-shell="bash" aria-pressed="true">Bash</button>
              <button class="curl-shell-option" data-shell="powershell" aria-pressed="false">PowerShell</button>
            </div>
            <pre class="modal-preview" id="curl-preview"></pre>
            <button id="curl-copy-btn">Copy</button>
          </div>
        </div>
      `;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
      initCurlCopy();
    });

    test('openCurlModal should show the modal with a bash preview and focus the first option', () => {
      openCurlModal(sampleRequest);

      const modal = document.getElementById('curl-modal');
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('curl-preview').textContent).toContain("curl '");
      expect(document.activeElement).toBe(document.querySelector('.curl-shell-option'));
    });

    test('openCurlModal should ignore requests without a URL', () => {
      openCurlModal({ operationName: 'NoUrl' });
      expect(document.getElementById('curl-modal').classList.contains('hidden')).toBe(true);
    });

    test('clicking a shell option should switch the preview and toggle active state', () => {
      openCurlModal(sampleRequest);

      const psOption = document.querySelector('[data-shell="powershell"]');
      psOption.click();

      expect(document.getElementById('curl-preview').textContent).toContain('Invoke-RestMethod');
      expect(psOption.classList.contains('active')).toBe(true);
      expect(psOption.getAttribute('aria-pressed')).toBe('true');

      const bashOption = document.querySelector('[data-shell="bash"]');
      expect(bashOption.classList.contains('active')).toBe(false);
      expect(bashOption.getAttribute('aria-pressed')).toBe('false');
    });

    test('copy button should write the preview to the clipboard and confirm', async () => {
      openCurlModal(sampleRequest);

      const copyBtn = document.getElementById('curl-copy-btn');
      copyBtn.click();
      await flushMicrotasks();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        document.getElementById('curl-preview').textContent
      );
      expect(copyBtn.textContent).toBe('Copied!');
    });

    test.each([
      ['close button', () => document.getElementById('curl-modal-close').click()],
      ['backdrop click', () => document.querySelector('.modal-backdrop').click()],
      [
        'Escape key',
        () =>
          document
            .getElementById('curl-modal')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ],
    ])('%s should close the modal', (_label, close) => {
      openCurlModal(sampleRequest);
      close();
      expect(document.getElementById('curl-modal').classList.contains('hidden')).toBe(true);
    });
  });

  describe('normalizeRequestHeaders', () => {
    test('should skip hop-by-hop and duplicate content headers', () => {
      expect(
        normalizeRequestHeaders({
          Cookie: 'a=b',
          Host: 'example.com',
          'Content-Length': '123',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        })
      ).toEqual([
        { name: 'Cookie', value: 'a=b' },
        { name: 'User-Agent', value: 'Mozilla/5.0' },
      ]);
    });
  });
});
