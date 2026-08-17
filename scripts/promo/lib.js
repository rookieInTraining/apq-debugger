/**
 * Shared helpers for promo screenshots and the demo video.
 *
 * The real panel (extension_build/devtools.html) is loaded inside
 * stage.html, which is copied into a temporary copy of the build so the
 * iframe is same-origin. Inside the panel frame, chrome.devtools is
 * mocked and chrome.runtime.sendMessage answers like the service worker
 * would, so no real tab is attached and no network traffic is touched.
 * Captured operations are injected through the panel's own onMessage
 * listeners — exactly the path the service worker's INTERCEPTED messages
 * take.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');
const { buildIntrospection, API } = require('./demo-data');

const ROOT = path.join(__dirname, '..', '..');
const BUILD_DIR = path.join(ROOT, 'extension_build');
const TAB_ID = 123;

/**
 * Copy the built extension plus the stage files into a fresh temp dir.
 * @returns {string} Path of the prepared extension.
 */
function prepareExtension() {
  if (!fs.existsSync(path.join(BUILD_DIR, 'devtools.html'))) {
    throw new Error('extension_build/ is missing — run `npm run build` first.');
  }
  const dir = path.join(os.tmpdir(), 'apq-debugger-promo-ext');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(BUILD_DIR, dir, { recursive: true });
  for (const file of ['stage.html', 'stage.js', 'tiles.html']) {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, file));
  }
  return dir;
}

/**
 * Launch Chrome with the prepared extension loaded.
 * @param {{recordVideoDir?: string, size?: {width: number, height: number}}} [options]
 */
async function launch({ recordVideoDir, size = { width: 1280, height: 800 } } = {}) {
  const extDir = prepareExtension();
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: size,
    deviceScaleFactor: 1,
    recordVideo: recordVideoDir ? { dir: recordVideoDir, size } : undefined,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = worker.url().split('/')[2];

  const introspection = buildIntrospection();
  await context.addInitScript(mockPanelRuntime, { tabId: TAB_ID, introspection, api: API });

  return { context, extensionId, extDir };
}

/**
 * Runs in every frame; only acts inside the panel frame (devtools.html).
 * Replaces chrome.devtools and the worker side of chrome.runtime.sendMessage.
 */
function mockPanelRuntime({ tabId, introspection, api }) {
  if (!location.pathname.endsWith('/devtools.html')) return;

  window.chrome.devtools = { inspectedWindow: { tabId }, panels: { create: () => {} } };

  // Copy buttons show their "Copied" state without needing window focus,
  // and recording never touches the real clipboard.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });

  const addListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  window.__apqListeners = [];
  chrome.runtime.onMessage.addListener = (fn) => {
    window.__apqListeners.push(fn);
    return addListener(fn);
  };

  const fake = { passiveMode: false, registrySize: 0, active: false };
  const notifyStage = (msg) => window.parent && window.parent.postMessage({ apqDemo: msg }, '*');

  chrome.runtime.sendMessage = (message, callback) => {
    let response = { status: 'SUCCESS' };
    if (message.patterns) {
      fake.active = true;
      response = { status: 'SUCCESS', message: 'Debugger attached' };
      notifyStage('started');
    } else if (message.disconnect) {
      fake.active = false;
      notifyStage('stopped');
    } else if (message.getStatus) {
      response = { status: 'SUCCESS', debuggerActive: fake.active };
    } else if (message.getRegistry || message.clearRegistry) {
      if (message.clearRegistry) fake.registrySize = 0;
      response = { status: 'SUCCESS', size: fake.registrySize, passiveMode: fake.passiveMode };
    } else if (message.setPassiveMode !== undefined) {
      fake.passiveMode = Boolean(message.setPassiveMode);
      response = { status: 'SUCCESS', size: fake.registrySize, passiveMode: fake.passiveMode };
    } else if (message.getObservedEndpoints) {
      response = { status: 'SUCCESS', endpoints: [api] };
    } else if (message.loadSchema) {
      response = { status: 'SUCCESS', endpoint: message.url || api, introspection };
    }
    if (typeof callback === 'function') setTimeout(() => callback(response), 250);
  };

  window.__apqDemo = fake;
}

/**
 * Open the stage page.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {{dark?: boolean, storage?: object, pageHeight?: number}} [options]
 */
async function openStage(context, extensionId, { dark = false, storage = {}, pageHeight } = {}) {
  const page = context.pages()[0] || (await context.newPage());
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'no-preference' });
  await page.goto(`chrome-extension://${extensionId}/stage.html`);
  await page.evaluate(
    (items) =>
      new Promise((resolve) =>
        chrome.storage.local.clear(() => chrome.storage.local.set(items, resolve))
      ),
    storage
  );
  await page.reload();
  await page.evaluate(
    ({ dark, pageHeight }) => {
      window.stage.setTheme(dark);
      if (pageHeight) window.stage.setPageHeight(pageHeight);
    },
    { dark, pageHeight }
  );
  await panelFrame(page).waitForSelector('#request-list');
  await page.waitForTimeout(500);
  return page;
}

/** @param {import('@playwright/test').Page} page */
function panelFrame(page) {
  const frame = page.frames().find((f) => f.url().endsWith('/devtools.html'));
  if (!frame) throw new Error('Panel frame not found');
  return frame;
}

/**
 * Deliver messages to the panel exactly as the service worker would.
 * @param {import('@playwright/test').Page} page
 * @param {object[]} messages - INTERCEPTED payloads (status added here).
 */
async function intercept(page, messages) {
  await panelFrame(page).evaluate(
    ({ list, tabId }) => {
      for (const m of list) {
        for (const fn of window.__apqListeners)
          fn({ status: 'INTERCEPTED', tabId, ...m }, {}, () => {});
      }
    },
    { list: messages, tabId: TAB_ID }
  );
}

/**
 * Play APQ exchanges: each hash row arrives, then its retry after `gap` ms.
 * @param {import('@playwright/test').Page} page
 * @param {object[][]} exchanges - Arrays of [hashMessage, retryMessage?].
 */
async function playExchanges(page, exchanges, gap = 650) {
  for (const exchange of exchanges) await intercept(page, [exchange[0]]);
  await page.waitForTimeout(gap);
  for (const exchange of exchanges) {
    if (exchange[1]) {
      await intercept(page, [exchange[1]]);
      await page.waitForTimeout(180);
    }
  }
}

/**
 * Move the drawn cursor to an element (in the stage or the panel) and click it.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {{showCursor?: boolean, dwell?: number}} [options]
 */
async function clickWithCursor(page, locator, { showCursor = true, dwell = 650 } = {}) {
  if (showCursor) {
    const box = await locator.boundingBox();
    if (box) {
      await page.evaluate(({ x, y }) => window.stage.cursorTo(x, y), {
        x: Math.round(box.x + Math.min(box.width / 2, 40)),
        y: Math.round(box.y + box.height / 2),
      });
      await page.waitForTimeout(dwell);
      await page.evaluate(() => window.stage.cursorClick());
    }
  }
  await locator.click();
}

/**
 * Type into a field with visible keystrokes.
 * @param {import('@playwright/test').Locator} locator
 * @param {string} text
 */
async function typeSlowly(locator, text, delay = 90) {
  await locator.pressSequentially(text, { delay });
}

module.exports = {
  ROOT,
  launch,
  openStage,
  panelFrame,
  intercept,
  playExchanges,
  clickWithCursor,
  typeSlowly,
};
