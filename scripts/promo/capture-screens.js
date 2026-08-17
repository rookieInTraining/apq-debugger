#!/usr/bin/env node

/**
 * Regenerate the Chrome Web Store screenshots and promo tiles from the
 * real panel UI (run `npm run build` first).
 *
 *   store/promo/screenshots/NN-*.png          1280x800
 *   store/promo/screenshots/_preview-640x400/  640x400 copies
 *   store/promo/tiles/*.png                    440x280, 920x680, 1400x560
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  ROOT,
  launch,
  openStage,
  panelFrame,
  playExchanges,
  intercept,
  clickWithCursor,
} = require('./lib');
const { apqExchange, fullQuery, unresolvedTelemetry } = require('./demo-data');

const OUT = path.join(ROOT, 'store', 'promo');
const SHOTS = path.join(OUT, 'screenshots');
const PREVIEWS = path.join(SHOTS, '_preview-640x400');
const TILES = path.join(OUT, 'tiles');

const SESSION = [
  apqExchange('GetViewer'),
  apqExchange('ProductListing'),
  apqExchange('CartSummary'),
  [fullQuery('AddToCart')],
  [unresolvedTelemetry],
  apqExchange('ProductRecommendations'),
];

const PANEL_STORAGE = { apqPatterns: ['*graphql*'], apqFirstRunNoteSeen: true };

async function startLive(page) {
  const panel = panelFrame(page);
  await clickWithCursor(page, panel.locator('#form-submit'), { showCursor: false });
  await page.waitForTimeout(400);
}

async function selectRow(page, name, nth = 'last') {
  const rows = panelFrame(page).locator('.request-item', { hasText: name });
  await (nth === 'last' ? rows.last() : rows.first()).click();
  await page.waitForTimeout(300);
}

async function settle(page) {
  // let toasts and the live-dot pulse finish so captures are steady
  await page.waitForTimeout(4200);
}

async function main() {
  for (const dir of [SHOTS, PREVIEWS, TILES]) fs.mkdirSync(dir, { recursive: true });
  const { context, extensionId, extDir } = await launch();
  const shoot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  // 01 · live session, dark, query open
  let page = await openStage(context, extensionId, {
    dark: true,
    storage: PANEL_STORAGE,
    pageHeight: 190,
  });
  await page.evaluate(() => window.stage.setCategory('outerwear'));
  await startLive(page);
  await playExchanges(page, SESSION);
  await selectRow(page, 'ProductListing');
  await settle(page);
  await shoot(page, '01-requests-dark');

  // 02 · light theme, a resolved hash with variables
  page = await openStage(context, extensionId, {
    dark: false,
    storage: PANEL_STORAGE,
    pageHeight: 190,
  });
  await page.evaluate(() => window.stage.setCategory('shoes'));
  await startLive(page);
  await playExchanges(page, SESSION);
  await selectRow(page, 'ProductRecommendations');
  await settle(page);
  await shoot(page, '02-request-detail');

  // 04 · light theme, patterns pane open, a hash resolving in place
  page = await openStage(context, extensionId, {
    dark: false,
    storage: { ...PANEL_STORAGE, apqPatterns: ['*graphql*', '*api/query*'] },
    pageHeight: 190,
  });
  await page.evaluate(() => window.stage.setCategory('outerwear'));
  await panelFrame(page).locator('#btn-toggle-patterns').click();
  await startLive(page);
  await playExchanges(page, SESSION.slice(0, 5));
  await settle(page);
  const last = apqExchange('ProductRecommendations');
  await intercept(page, [last[0]]);
  await page.waitForTimeout(500);
  await intercept(page, [last[1]]);
  await page.waitForTimeout(140);
  await shoot(page, '04-requests-light');

  // 03 · schema explorer, dark
  page = await openStage(context, extensionId, {
    dark: true,
    storage: PANEL_STORAGE,
    pageHeight: 170,
  });
  const panel = panelFrame(page);
  await panel.locator('#tab-schema').click();
  await panel.locator('#btn-load-schema').click();
  await panel.locator('.schema-type-item', { hasText: 'Product' }).first().waitFor();
  await panel.locator('.schema-type-item[data-type-name="Product"]').click();
  await page.waitForTimeout(400);
  await shoot(page, '03-schema');

  // 05 · toolbar toggle
  page = await openStage(context, extensionId, {
    dark: false,
    storage: PANEL_STORAGE,
    pageHeight: 260,
  });
  await startLive(page);
  await playExchanges(page, SESSION.slice(0, 3));
  await settle(page);
  await page.evaluate(() => window.stage.menu(true));
  await shoot(page, '05-toolbar');

  // 640x400 previews
  for (const file of fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png'))) {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(SHOTS, file),
      '-vf',
      'scale=640:400:flags=lanczos',
      path.join(PREVIEWS, file),
    ]);
  }

  // promo tiles, built from the fresh screenshots
  fs.mkdirSync(path.join(extDir, 'shots'), { recursive: true });
  fs.copyFileSync(
    path.join(SHOTS, '01-requests-dark.png'),
    path.join(extDir, 'shots', '01-requests-dark.png')
  );
  page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 1700 });
  await page.goto(`chrome-extension://${extensionId}/tiles.html`);
  await page.waitForLoadState('load');
  const tiles = { small: 'small-440x280', large: 'large-920x680', marquee: 'marquee-1400x560' };
  for (const [id, name] of Object.entries(tiles)) {
    await page.locator(`#${id}`).screenshot({ path: path.join(TILES, `${name}.png`) });
  }

  await context.close();
  console.log(`Screenshots → ${path.relative(ROOT, SHOTS)}\nTiles → ${path.relative(ROOT, TILES)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
