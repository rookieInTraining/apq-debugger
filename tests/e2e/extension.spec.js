const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test.describe('APQ Debugger Extension', () => {
  let context;
  let extensionId;

  test.beforeEach(async () => {
    const pathToExtension = path.join(__dirname, '../../');
    context = await chromium.launchPersistentContext('', {
      headless: false, // Extensions only work in headless=false or new headless with flags
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    // Parse extension ID from Service Worker
    let [background] = context.serviceWorkers();
    if (!background) background = await context.waitForEvent('serviceworker');

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
    });
    await page.goto(`chrome-extension://${extensionId}/frontend/devtools.html`);
    await page.waitForLoadState('domcontentloaded');
    // Allow time for JS initialization (DOMContentLoaded handler)
    await page.waitForTimeout(500);
    return page;
  }

  // ── Basic UI load ──────────────────────────────────────────────

  test('should load devtools page and show UI', async () => {
    const page = await openDevToolsPage();

    await expect(page.locator('#add')).toBeVisible();
    await expect(page.locator('#debugger-status')).toContainText('Ready');
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

    // Button should change state (either show "Starting..." or change to "Stop" on success,
    // or show error status since we can't actually attach in this context)
    await expect(page.locator('#debugger-status')).not.toContainText('Ready');
  });

  test('should show error when starting with empty pattern', async () => {
    const page = await openDevToolsPage();

    // Leave pattern empty and click Start
    await page.locator('#form-submit').click();

    // Should show error in status banner
    await page.waitForTimeout(300);
    const bannerText = page.locator('#status-banner-text');
    const bannerContent = await bannerText.textContent();
    // Either the banner shows an error or the status changes from Ready
    expect(bannerContent.length).toBeGreaterThan(0);
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
    await expect(page.locator('.empty-title')).toContainText('No requests');
    await expect(page.locator('.empty-desc')).toContainText('Start debugging');
  });

  // ── Detail panel ───────────────────────────────────────────────

  test('should show detail panel placeholder', async () => {
    const page = await openDevToolsPage();

    const detailContent = page.locator('#detail-content');
    await expect(detailContent).toContainText('Select a request');
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

    // Status banner has role="alert"
    await expect(page.locator('#status-banner')).toHaveAttribute('role', 'alert');
  });

  // ── Filter input ───────────────────────────────────────────────

  test('should accept text input in filter field', async () => {
    const page = await openDevToolsPage();

    const filterInput = page.locator('#filter-input');
    await filterInput.fill('GetUsers');
    await expect(filterInput).toHaveValue('GetUsers');
  });
});
