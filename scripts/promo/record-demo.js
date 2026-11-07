#!/usr/bin/env node

/**
 * Record the demo video by performing store/promo/video/demo-script.md
 * scene by scene against the real panel (run `npm run build` first).
 *
 * Frames come from Chrome's screencast (full quality, timestamped) and
 * are encoded to H.264 at a constant 30 fps with ffmpeg.
 *
 *   store/promo/video/apq-debugger-demo.mp4
 *   store/promo/video/apq-debugger-demo-poster.png
 *   store/promo/video/apq-debugger-demo-cues.json (scene timings for the voiceover)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  ROOT,
  launch,
  openStage,
  panelFrame,
  intercept,
  holdRequest,
  playExchanges,
  clickWithCursor,
  typeSlowly,
} = require('./lib');
const { apqExchange, fullQuery, heldRequest, unresolvedTelemetry } = require('./demo-data');

const OUT_DIR = path.join(ROOT, 'store', 'promo', 'video');
const OUT_FILE = path.join(OUT_DIR, 'apq-debugger-demo.mp4');
const POSTER = path.join(OUT_DIR, 'apq-debugger-demo-poster.png');
/** Scene timings (seconds into the video) for placing the voiceover. */
const CUES = path.join(OUT_DIR, 'apq-debugger-demo-cues.json');
const FRAMES = path.join(os.tmpdir(), 'apq-debugger-demo-frames');

/** Capture timestamped screencast frames until stop() is called. */
async function startScreencast(page) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(FRAMES, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId });
    } catch (_) {
      /* session closing */
    }
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: 1,
  });
  return {
    async stop() {
      // Static scenes emit no frames; remember when recording ended so the
      // last frame holds until then.
      frames.stopAt = Date.now() / 1000;
      await cdp.send('Page.stopScreencast');
      return frames;
    },
  };
}

/** Encode variable-rate frames to constant 30 fps H.264. */
function encode(frames) {
  if (frames.length < 2) throw new Error('No frames captured');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1];
    const end = next ? next.t : frames.stopAt || frames[i].t + 1;
    const duration = Math.max(end - frames[i].t, 0.001);
    lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`, `duration ${duration.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  const list = path.join(FRAMES, 'frames.txt');
  fs.writeFileSync(list, lines.join('\n'));

  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-vf',
    'fps=30,scale=1280:800:flags=lanczos,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    OUT_FILE,
  ]);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { context, extensionId } = await launch();

  // Fresh profile: no saved pattern, first-run note not yet seen.
  const page = await openStage(context, extensionId, { dark: false, storage: {}, pageHeight: 200 });
  const panel = panelFrame(page);
  const stage = (fn, ...args) =>
    page.evaluate(({ fn, args }) => window.stage[fn](...args), { fn, args });
  const hold = (ms) => page.waitForTimeout(ms);
  // Cues (wall-clock, converted to video time after recording) let the
  // voiceover be placed on each caption when audio is mixed in post.
  const cues = [];
  const cue = (id, text) => cues.push({ id, text, t: Date.now() / 1000 });
  const caption = (text, placement) => {
    if (text) cue('caption', text);
    return stage('caption', text, placement);
  };

  await stage('card', 'GraphQL Debugger', 'Pause, edit and read every GraphQL request.');
  await hold(600);
  const cast = await startScreencast(page);
  cue('title', 'GraphQL Debugger. Pause, edit and read every GraphQL request.');

  // Scene 1 · Title
  await hold(4500);
  await stage('card', null);

  // Scene 2 · The problem
  await stage('callout', true);
  await caption(
    'Apollo’s Automatic Persisted Queries send a SHA-256 hash, not the query. The Network panel can’t show you what ran.'
  );
  await hold(7500);
  await stage('callout', false);

  // Scene 3 · Set a pattern
  await caption('Tell GraphQL Debugger which requests to watch.');
  await hold(900);
  const patternInput = panel.locator('.urlPattern').first();
  await clickWithCursor(page, patternInput);
  await typeSlowly(patternInput, '*graphql*', 110);
  await hold(2200);

  // Scene 4 · Start
  await caption('Press Start (Ctrl+E). The bar stays up whenever requests are being rewritten.');
  await clickWithCursor(page, panel.locator('#form-submit'));
  await hold(3800);
  await clickWithCursor(page, panel.locator('#live-note-dismiss'));
  await hold(900);
  await clickWithCursor(page, panel.locator('#btn-toggle-patterns'));
  await hold(1000);

  // Scene 5 · Browse and watch hashes resolve
  await caption(
    'Each hash is swapped, the server asks for the full query, and Apollo retries. The row resolves in place.'
  );
  await clickWithCursor(page, page.locator('#cats [data-cat="outerwear"]'));
  await stage('setCategory', 'outerwear');
  await playExchanges(
    page,
    [apqExchange('GetViewer'), apqExchange('ProductListing'), [unresolvedTelemetry]],
    1400
  );
  await hold(1800);
  await clickWithCursor(page, page.locator('#grid .product .add').first());
  await stage('setCart', 1);
  await intercept(page, [fullQuery('AddToCart')]);
  await playExchanges(page, [apqExchange('CartSummary')], 1200);
  await hold(2200);

  // Scene 6 · Read the query
  await caption('Open any operation to read and copy the full query and its variables.');
  const listingRow = panel.locator('.request-item', { hasText: 'ProductListing' }).filter({
    has: panel.locator('.state--resolved'),
  });
  await clickWithCursor(page, listingRow);
  await hold(2600);
  await clickWithCursor(page, panel.locator('.btn-copy[data-copy="query"]'));
  await hold(1800);
  await clickWithCursor(page, panel.locator('a[href="#detail-variables"]'));
  await hold(2600);

  // Scene 7 · Copy as cURL
  await caption(
    'Copy as cURL to replay it from a terminal, with the headers captured from the page.',
    'top'
  );
  await clickWithCursor(page, panel.locator('#btn-copy-curl'));
  await hold(3200);
  await clickWithCursor(page, panel.locator('.curl-shell-option[data-shell="powershell"]'));
  await hold(2600);
  await clickWithCursor(page, panel.locator('#curl-copy-btn'));
  await hold(1600);
  await clickWithCursor(page, panel.locator('#curl-modal-close'));
  await hold(800);

  // Scene 8 · Pause and edit a request
  await caption(
    'Set a breakpoint on an operation name. Matching requests pause before they are sent.'
  );
  await clickWithCursor(page, panel.locator('#tab-breakpoints'));
  await hold(700);
  const bpName = panel.locator('#bp-list .bp-name').first();
  await clickWithCursor(page, bpName);
  await typeSlowly(bpName, 'AddToCart', 110);
  await bpName.press('Enter');
  await hold(500);
  await clickWithCursor(page, panel.locator('#bp-debug-mode'));
  await hold(1200);
  await clickWithCursor(page, page.locator('#grid .product .add').nth(1));
  await intercept(page, [fullQuery('AddToCart')]);
  await holdRequest(page, heldRequest('AddToCart', 'demo-hold-1'));
  await hold(3600);

  await caption(
    'Edit the query, variables or headers, then resume. Only the request waits; the page keeps running.'
  );
  await clickWithCursor(page, panel.locator('#bp-tab-variables'));
  await hold(800);
  const variablesBox = panel.locator('#bp-variables');
  await clickWithCursor(page, variablesBox);
  const edited = (await variablesBox.inputValue()).replace('"quantity": 1', '"quantity": 3');
  await variablesBox.fill(edited);
  await hold(1600);
  await clickWithCursor(page, panel.locator('#bp-resume'));
  const resumedQty = await panel.evaluate(
    () => window.__apqDemo.lastResume?.edits?.operations?.[0]?.variables?.input?.quantity ?? 1
  );
  await stage('setCart', 1 + resumedQty);
  await hold(2600);
  await clickWithCursor(page, panel.locator('#bp-debug-mode'));
  await hold(900);
  await clickWithCursor(page, panel.locator('#tab-requests'));
  await hold(700);

  // Scene 9 · Find things fast
  await caption('Filter by name, URL or request type.');
  const filter = panel.locator('#filter-input');
  await clickWithCursor(page, filter);
  await typeSlowly(filter, 'Cart', 140);
  await hold(1500);
  await filter.fill('');
  await panel.evaluate(() =>
    document.getElementById('filter-input').dispatchEvent(new Event('input'))
  );
  await clickWithCursor(page, panel.locator('.chip[data-filter="apq"]'));
  await hold(1400);
  await clickWithCursor(page, panel.locator('.chip[data-filter="all"]'));
  await hold(900);

  // Scene 10 · Browse the schema
  await caption('Load the schema by introspection, reusing the headers from live traffic.');
  await clickWithCursor(page, panel.locator('#tab-schema'));
  await hold(700);
  await clickWithCursor(page, panel.locator('#btn-load-schema'));
  await panel.locator('.schema-type-item[data-type-name="Product"]').waitFor();
  await hold(900);
  await clickWithCursor(page, panel.locator('.schema-type-item[data-type-name="Product"]'));
  await hold(2800);

  // Scene 11 · Stop
  await caption('Stop when you’re done. Nothing from your traffic leaves your browser.');
  await clickWithCursor(page, panel.locator('#tab-requests'));
  await hold(600);
  await clickWithCursor(page, panel.locator('#form-submit'));
  await hold(4800);

  // Scene 12 · End card
  await caption('');
  await stage('hideCursor');
  cue('end', 'GraphQL Debugger. Breakpoints, APQ and schema for GraphQL, in DevTools.');
  await stage('card', 'GraphQL Debugger', 'Breakpoints, APQ and schema for GraphQL, in DevTools');
  await hold(5500);

  const frames = await cast.stop();
  const start = frames[0].t;
  fs.writeFileSync(
    CUES,
    JSON.stringify(
      cues.map((c) => ({ ...c, t: Math.max(0, +(c.t - start).toFixed(3)) })),
      null,
      2
    ) + '\n'
  );
  await stage('card', 'GraphQL Debugger', 'Pause, edit and read every GraphQL request.');
  await page.screenshot({ path: POSTER });
  await context.close();

  encode(frames);
  fs.rmSync(FRAMES, { recursive: true, force: true });
  console.log(`Video → ${path.relative(ROOT, OUT_FILE)} (${frames.length} source frames)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
