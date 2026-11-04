const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

// NOTE: run `npm run build` first — the extension is loaded from extension_build/
//
// Drives a real request through the real service worker: the panel attaches
// the Chrome debugger to an http page, the page's fetch is held by
// Fetch.requestPaused, and the panel resumes, edits or fails it.

const APP_HTML = fs.readFileSync(path.join(__dirname, 'fixtures', 'graphql-app.html'), 'utf8');

/** Serves the app at `/` and a `/graphql` endpoint that echoes `variables.c`. */
function startAppServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/graphql') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        let currency = 'none';
        try {
          const body = JSON.parse(raw);
          currency = (body.variables && body.variables.c) || 'none';
        } catch (_) {
          currency = 'invalid';
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { cart: currency } }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(APP_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.describe('Request breakpoints', () => {
  let server;
  let appUrl;
  let context;
  let background;
  let extensionId;

  test.beforeAll(async () => {
    server = await startAppServer();
    appUrl = `http://127.0.0.1:${server.address().port}/`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test.beforeEach(async () => {
    const pathToExtension = path.join(__dirname, '../../extension_build');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    [background] = context.serviceWorkers();
    const deadline = Date.now() + 20000;
    while (!background && Date.now() < deadline) {
      background = await Promise.race([
        context.waitForEvent('serviceworker', { timeout: 1000 }).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      if (!background) [background] = context.serviceWorkers();
    }
    extensionId = background.url().split('/')[2];
  });

  test.afterEach(async () => {
    await context.close();
  });

  /** Open the app page and return it with its real tab id. */
  async function openApp() {
    const app = await context.newPage();
    await app.goto(appUrl);
    const tabs = await background.evaluate(() => chrome.tabs.query({}));
    const tab = tabs.find((t) => t.url === appUrl);
    expect(tab, `no tab found for ${appUrl}`).toBeDefined();
    return { app, tabId: tab.id };
  }

  /** Open devtools.html as a page that inspects the given tab. */
  async function openPanel(tabId) {
    const panel = await context.newPage();
    await panel.addInitScript((id) => {
      window.chrome.devtools = {
        inspectedWindow: { tabId: id },
        panels: { create: () => {} },
      };
    }, tabId);
    await panel.goto(`chrome-extension://${extensionId}/devtools.html`);
    await panel.waitForLoadState('domcontentloaded');
    await panel.waitForTimeout(500);
    return panel;
  }

  /**
   * Wait until the service worker has stored the tab's debug state flag.
   * @param {number} tabId
   * @param {'debugMode'|'pauseNext'} flag
   */
  async function waitForDebugFlag(tabId, flag) {
    await expect
      .poll(() =>
        background.evaluate(
          async ({ id, key }) => {
            const stored = await chrome.storage.session.get('gqlDebugState');
            const states = stored.gqlDebugState || {};
            return !!(states[id] && states[id][key]);
          },
          { id: tabId, key: flag }
        )
      )
      .toBe(true);
  }

  /** Start interception on `*graphql*` and turn on debug mode. */
  async function startDebugging(panel, tabId) {
    await panel.locator('.urlPattern').first().fill('*graphql*');
    await panel.locator('#form-submit').click();
    await expect(panel.locator('#debugger-status')).toContainText('Intercepting', {
      timeout: 10000,
    });

    await panel.locator('#tab-breakpoints').click();
    await panel.locator('#bp-debug-mode').check();
    await expect(panel.locator('#bp-debug-mode')).toBeChecked();
    await waitForDebugFlag(tabId, 'debugMode');
  }

  /** Add a breakpoint on an operation name (saved on blur). */
  async function addBreakpoint(panel, name) {
    const field = panel.locator('#bp-list .bp-name').last();
    await field.fill(name);
    await field.press('Enter');
    await expect
      .poll(() =>
        background.evaluate(async () => {
          const stored = await chrome.storage.local.get('gqlBreakpoints');
          return (stored.gqlBreakpoints || []).map((bp) => bp.name);
        })
      )
      .toContain(name);
  }

  test('pauses on a breakpoint and resumes with edited variables', async () => {
    const { app, tabId } = await openApp();
    const panel = await openPanel(tabId);
    await startDebugging(panel, tabId);
    await addBreakpoint(panel, 'GetCart');

    await app.locator('#named').click();

    await expect(panel.locator('#bp-infobar-text')).toHaveText('Paused on GetCart');
    await expect(panel.locator('#debugger-status')).toContainText('Paused');
    await app.waitForTimeout(1000);
    await expect(app.locator('#out')).toHaveText('');

    await panel.locator('#bp-tab-variables').click();
    await panel.locator('#bp-variables').fill('{"c":"EUR"}');
    await panel.locator('#bp-resume').click();

    await expect(app.locator('#out')).toContainText('EUR');
    await expect(panel.locator('#bp-infobar')).toBeHidden();
  });

  test('pause on next request, then fail it', async () => {
    const { app, tabId } = await openApp();
    const panel = await openPanel(tabId);
    await startDebugging(panel, tabId);

    await panel.locator('#bp-pause-next').click();
    await expect(panel.locator('#bp-pause-next')).toHaveAttribute('aria-pressed', 'true');
    await waitForDebugFlag(tabId, 'pauseNext');

    await app.locator('#anonymous').click();

    await expect(panel.locator('#bp-infobar-text')).toHaveText('Paused on anonymous operation');
    await expect(app.locator('#out')).toHaveText('');

    await panel.locator('#bp-fail').click();

    await expect(app.locator('#out')).toContainText('Fetch error');
  });

  test('closing the panel while paused releases the request unmodified', async () => {
    const { app, tabId } = await openApp();
    const panel = await openPanel(tabId);
    await startDebugging(panel, tabId);
    await addBreakpoint(panel, 'GetCart');

    await app.locator('#named').click();
    await expect(panel.locator('#bp-infobar-text')).toHaveText('Paused on GetCart');
    await expect(app.locator('#out')).toHaveText('');

    // An unsent edit must not travel with the released request
    await panel.locator('#bp-tab-variables').click();
    await panel.locator('#bp-variables').fill('{"c":"EUR"}');
    await panel.close();

    await expect(app.locator('#out')).toContainText('USD', { timeout: 5000 });
    await expect(app.locator('#out')).not.toContainText('EUR');
  });
});
