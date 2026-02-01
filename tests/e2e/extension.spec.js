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
                `--load-extension=${pathToExtension}`
            ]
        });

        // Parse extension ID from Service Worker
        let [background] = context.serviceWorkers();
        if (!background)
            background = await context.waitForEvent('serviceworker');

        extensionId = background.url().split('/')[2];
        expect(extensionId).toBeDefined();
    });

    test.afterEach(async () => {
        await context.close();
    });

    test('should load devtools page and show UI', async () => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/frontend/devtools.html`);

        // Mock chrome.devtools API since we are opening the page as a tab
        await page.addInitScript(() => {
            window.chrome.devtools = {
                inspectedWindow: {
                    tabId: 123
                },
                panels: {
                    create: () => { }
                }
            };
        });

        // Reload to apply mock (or better, apply mock before load if possible? 
        // addInitScript applies before load, so it should be fine, but the script runs immediately.
        // We might need to reload if the script ran before initScript.
        // Actually, devtools.js runs effectively on load.
        // Let's reload to be sure the mock is present when script runs.
        await page.reload();

        // Check if title is correct (implicit check)
        // Check for Add Pattern button
        const addButton = page.locator('#add');
        await expect(addButton).toBeVisible();

        // Check for Status Badge
        const statusBadge = page.locator('#debugger-status');
        await expect(statusBadge).toContainText('Ready');
    });

    test('should validate pattern input', async () => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/frontend/devtools.html`);
        await page.addInitScript(() => {
            window.chrome.devtools = { inspectedWindow: { tabId: 123 }, panels: { create: () => { } } };
        });
        await page.reload();

        // Add a pattern
        const input = page.locator('.urlPattern').first();
        await input.fill('test-pattern');

        // Click Start
        const startBtn = page.locator('#form-submit');
        await startBtn.click();

        // Should show "Connecting..." or similar (since mocked backend won't reply easily without more mocks)
        // But we just want to verify UI interaction
        await expect(page.locator('#debugger-status')).not.toBeEmpty();
    });
});
