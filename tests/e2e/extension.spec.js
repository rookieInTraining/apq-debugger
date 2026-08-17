const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

// NOTE: run `npm run build` first — the extension is loaded from extension_build/
test.describe('APQ Debugger Extension', () => {
  let context;
  let extensionId;

  test.beforeEach(async () => {
    const pathToExtension = path.join(__dirname, '../../extension_build');
    context = await chromium.launchPersistentContext('', {
      headless: false, // Extensions only work in headless=false or new headless with flags
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    // Parse extension ID from Service Worker. The worker may register
    // before or after this point, so poll rather than rely on one event.
    let [background] = context.serviceWorkers();
    if (!background) {
      const deadline = Date.now() + 20000;
      while (!background && Date.now() < deadline) {
        background = await Promise.race([
          context.waitForEvent('serviceworker', { timeout: 1000 }).catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
        ]);
        if (!background) [background] = context.serviceWorkers();
      }
    }

    extensionId = background.url().split('/')[2];
    expect(extensionId).toBeDefined();
  });

  test.afterEach(async () => {
    await context.close();
  });

  // Helper: open devtools page with mocked chrome.devtools
  async function openDevToolsPage() {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.chrome.devtools = {
        inspectedWindow: { tabId: 123 },
        panels: { create: () => {} },
      };
      // Capture the panel's onMessage listeners so tests can deliver
      // service-worker messages (e.g. INTERCEPTED) directly.
      const listeners = [];
      const addListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
      chrome.runtime.onMessage.addListener = (fn) => {
        listeners.push(fn);
        return addListener(fn);
      };
      window.__deliver = (message) => listeners.forEach((fn) => fn(message, {}, () => {}));
    });
    await page.goto(`chrome-extension://${extensionId}/devtools.html`);
    await page.waitForLoadState('domcontentloaded');
    // Allow time for JS initialization (DOMContentLoaded handler)
    await page.waitForTimeout(500);
    return page;
  }

  // ── Basic UI load ──────────────────────────────────────────────

  test('should load devtools page and show UI', async () => {
    const page = await openDevToolsPage();

    await expect(page.locator('#add')).toBeVisible();
    await expect(page.locator('#debugger-status')).toContainText('Off');
    await expect(page.locator('#form-submit')).toContainText('Start');
    await expect(page.locator('#interception-counter')).toContainText('0');
  });

  // ── Pattern management ─────────────────────────────────────────

  test('should add and remove pattern fields', async () => {
    const page = await openDevToolsPage();

    // Initially one pattern input
    await expect(page.locator('.urlPattern')).toHaveCount(1);

    // Add two more patterns
    await page.locator('#add').click();
    await page.locator('#add').click();
    await expect(page.locator('.urlPattern')).toHaveCount(3);

    // Remove the last added pattern (click its remove button)
    const removeButtons = page.locator('.btn-remove');
    const visibleRemoveCount = await removeButtons.count();
    if (visibleRemoveCount > 0) {
      await removeButtons.last().click();
      await expect(page.locator('.urlPattern')).toHaveCount(2);
    }
  });

  test('should fill multiple patterns', async () => {
    const page = await openDevToolsPage();

    // Fill the first pattern
    await page.locator('.urlPattern').first().fill('*graphql*');

    // Add and fill a second pattern
    await page.locator('#add').click();
    await page.locator('.urlPattern').nth(1).fill('*api/query*');

    // Verify both patterns have values
    await expect(page.locator('.urlPattern').first()).toHaveValue('*graphql*');
    await expect(page.locator('.urlPattern').nth(1)).toHaveValue('*api/query*');
  });

  // ── Pattern persistence ────────────────────────────────────────

  test('should persist patterns across page reload', async () => {
    const page = await openDevToolsPage();

    // Fill the first pattern
    await page.locator('.urlPattern').first().fill('*graphql*');

    // Wait for storage write to complete
    await page.waitForTimeout(500);

    // Reload page (addInitScript persists across navigations)
    await page.reload();
    await page.waitForTimeout(500);

    // Pattern should be restored
    await expect(page.locator('.urlPattern').first()).toHaveValue('*graphql*');
  });

  // ── Start/stop button state ────────────────────────────────────

  test('should change button state when start is clicked', async () => {
    const page = await openDevToolsPage();

    // Fill a pattern so the start action is valid
    await page.locator('.urlPattern').first().fill('*graphql*');

    // Click Start
    const startBtn = page.locator('#form-submit');
    await startBtn.click();

    // Button should change state (either show "Starting…" or change to "Stop" on success,
    // or show error status since we can't actually attach in this context)
    await expect(page.locator('#debugger-status')).not.toContainText('Off');
  });

  test('should show error when starting with empty pattern', async () => {
    const page = await openDevToolsPage();

    // Leave pattern empty and click Start
    await page.locator('#form-submit').click();

    // Should show an error toast in the stack
    await page.waitForTimeout(300);
    const toastText = page.locator('#status-banner .toast .toast-text');
    const toastContent = await toastText.first().textContent();
    expect(toastContent.length).toBeGreaterThan(0);
  });

  // ── Filter chips ───────────────────────────────────────────────

  test('should toggle filter chips', async () => {
    const page = await openDevToolsPage();

    // Check filter chips exist
    await expect(page.locator('.chip[data-filter="all"]')).toBeVisible();
    await expect(page.locator('.chip[data-filter="apq"]')).toBeVisible();
    await expect(page.locator('.chip[data-filter="full"]')).toBeVisible();

    // "All" chip should be active by default
    await expect(page.locator('.chip[data-filter="all"]')).toHaveClass(/active/);

    // Click APQ chip
    await page.locator('.chip[data-filter="apq"]').click();
    await expect(page.locator('.chip[data-filter="apq"]')).toHaveClass(/active/);
    await expect(page.locator('.chip[data-filter="all"]')).not.toHaveClass(/active/);

    // Click Full chip
    await page.locator('.chip[data-filter="full"]').click();
    await expect(page.locator('.chip[data-filter="full"]')).toHaveClass(/active/);
    await expect(page.locator('.chip[data-filter="apq"]')).not.toHaveClass(/active/);

    // Click All to reset
    await page.locator('.chip[data-filter="all"]').click();
    await expect(page.locator('.chip[data-filter="all"]')).toHaveClass(/active/);
  });

  // ── Empty state ────────────────────────────────────────────────

  test('should display empty state when no requests', async () => {
    const page = await openDevToolsPage();

    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-title')).toContainText('No operations captured');
    await expect(page.locator('#empty-steps')).toContainText('Start');
  });

  // ── Detail panel ───────────────────────────────────────────────

  test('should show detail panel placeholder', async () => {
    const page = await openDevToolsPage();

    const detailContent = page.locator('#detail-content');
    await expect(detailContent).toContainText('Select a request');
  });

  test('should open Copy as cURL with a reachable Copy button', async () => {
    const page = await openDevToolsPage();

    // Deliver a captured request the way the service worker does, with a
    // long single-line query so the cURL preview is much wider than the panel.
    const longQuery = `query Long { ${Array.from({ length: 80 }, (_, i) => `field${i}`).join(' ')} }`;
    await page.evaluate(
      ({ query }) =>
        window.__deliver({
          status: 'INTERCEPTED',
          tabId: 123,
          operationName: 'Long',
          url: 'https://api.example.com/graphql',
          isAPQ: false,
          query,
          headers: [{ name: 'content-type', value: 'application/json' }],
        }),
      { query: longQuery }
    );

    await page.locator('.request-item').first().click();
    await page.locator('#btn-copy-curl').click();

    await expect(page.locator('#curl-modal')).toBeVisible();
    await expect(page.locator('#curl-preview')).toContainText('curl ');
    await expect(page.locator('#curl-modal .modal-panel')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#curl-copy-btn')).toBeInViewport();
    await page.locator('#curl-copy-btn').click({ timeout: 5000 });
  });

  // ── Accessibility ──────────────────────────────────────────────

  test('should have accessible elements with ARIA attributes', async () => {
    const page = await openDevToolsPage();

    // Header has role="banner"
    await expect(page.locator('header[role="banner"]')).toBeVisible();

    // Status badge has role="status" and aria-live
    const statusBadge = page.locator('#debugger-status');
    await expect(statusBadge).toHaveAttribute('role', 'status');
    await expect(statusBadge).toHaveAttribute('aria-live', 'polite');

    // Filter input has aria-label
    await expect(page.locator('#filter-input')).toHaveAttribute('aria-label', /Filter/);

    // Request list has role="listbox"
    await expect(page.locator('#request-list')).toHaveAttribute('role', 'listbox');

    // Toast stack is a polite live region; error toasts get role="alert"
    await expect(page.locator('#status-banner')).toHaveAttribute('role', 'status');
    await expect(page.locator('#status-banner')).toHaveAttribute('aria-live', 'polite');
  });

  // ── Filter input ───────────────────────────────────────────────

  test('should accept text input in filter field', async () => {
    const page = await openDevToolsPage();

    const filterInput = page.locator('#filter-input');
    await filterInput.fill('GetUsers');
    await expect(filterInput).toHaveValue('GetUsers');
  });

  // ── Settings popover ───────────────────────────────────────────

  test('should open settings popover and switch theme', async () => {
    const page = await openDevToolsPage();

    const settingsBtn = page.locator('#btn-settings');
    await expect(settingsBtn).toBeVisible();

    await settingsBtn.click();
    await expect(page.locator('#settings-popover')).toBeVisible();
    await expect(settingsBtn).toHaveAttribute('aria-expanded', 'true');

    await page.locator('.menu-option:has(input[name="theme"][value="dark"])').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('.menu-option:has(input[name="density"][value="compact"])').click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('should toggle the patterns pane from the toolbar', async () => {
    const page = await openDevToolsPage();

    const toggleBtn = page.locator('#btn-toggle-patterns');
    const pane = page.locator('#patterns-pane');
    await expect(toggleBtn).toBeVisible();

    // First run (no saved patterns): the pane starts open
    await expect(pane).toBeVisible();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    await toggleBtn.click();
    await expect(pane).toBeHidden();
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    await toggleBtn.click();
    await expect(pane).toBeVisible();
  });

  // ── Schema tab ─────────────────────────────────────────────────

  test('should show schema tab with load controls', async () => {
    const page = await openDevToolsPage();

    await page.locator('#tab-schema').click();
    await expect(page.locator('#schema-content')).toBeVisible();
    await expect(page.locator('#btn-load-schema')).toContainText('Load schema');
    await expect(page.locator('#schema-status')).toContainText('No schema loaded');
    await expect(page.locator('#schema-url-input')).toBeVisible();
  });

  // ── Main panel tabs ────────────────────────────────────────────

  test('should show requests tab selected by default', async () => {
    const page = await openDevToolsPage();

    await expect(page.locator('#tab-requests')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-schema')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#requests-content')).toBeVisible();
  });
});
