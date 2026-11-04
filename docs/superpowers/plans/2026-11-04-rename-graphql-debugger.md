# Rename to GraphQL Debugger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user-facing surface says "GraphQL Debugger" instead of "APQ Debugger" / "Apollo GraphQL Persisted Queries (APQ) Debugger", with APQ kept as the lead feature in copy.

**Architecture:** String and copy changes only — no behaviour change. Internal identifiers (`apq-debugger` package name, `apq*` storage keys, module names, `ACTION_MENU_ID`) stay as they are so stored user data survives the update.

**Tech Stack:** Chrome MV3 extension, esbuild build, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-graphql-debugger-design.md` (Part 1). Plan 1 of 3; then `2026-11-04-request-breakpoints.md`, then `2026-11-04-opt-in-analytics.md`. All three ship in one release.

## Global Constraints

- Name: `GraphQL Debugger`. Never "GraphQL DevTools", never "Apollo" in the name, title or icon.
- Apollo appears only factually in descriptions: "works with Apollo Client, Relay, urql and more", "reveal Apollo APQ queries".
- Same store listing and extension ID; do not touch `key`/ID-related manifest fields or `ext.pem`.
- Do not rename storage keys (`apqPatterns`, `apqHashRegistry`, …), the npm package name, the repo, or module files.
- Sentence-case copy (`CLAUDE.md`).
- `store/promo/video/` contains uncommitted owner work (video, poster, `demo-script.md`): do not regenerate or overwrite the video in this plan — the demo is re-recorded at the end of the breakpoints plan.
- Work on a branch, not `trunk` (`git switch -c graphql-debugger` before Task 1; the other two plans continue on it).

## Review Focus

1. Existing users' stored patterns/registry/settings after update — must be untouched (no storage key renamed). Covered by the "storage keys unchanged" check in Task 1.
2. The Chrome "is debugging this browser" infobar shows the manifest `name` — it must read "GraphQL Debugger" (short enough not to truncate). Covered by Task 1's manifest test.
3. Stray "APQ Debugger" strings left in UI copy (empty states, toasts, notifications). Covered by Task 1's grep check.
4. Store short description over 132 characters. Covered by Task 2's length check.
5. Promo scripts still referencing the old name produce outdated screenshots. Covered by Task 3.

---

### Task 1: Rename in the extension itself

**Files:**
- Modify: `manifest.json` (`name`, `description`, `action.default_title`)
- Modify: `package.json` (`description` only)
- Modify: `js/ui/index.js:33-39,155` (panel title + logs)
- Modify: `js/sw/index.js:66,71,80` (context menu title + logs)
- Modify: `js/sw/messaging.js:66-73` (notification title and message)
- Modify: `frontend/devtools.html:6,95` (`<title>`, `aria-label`) and any other "APQ Debugger" copy in the file
- Modify: `build-enhanced.js:4`, `install-deps.js:4,11` (header comments/log)
- Modify: `tests/e2e/extension.spec.js:5` (describe name)
- Test: `tests/unit/branding.test.js` (new)

**Interfaces:** none produced.

- [ ] **Step 1: Write the failing test** `tests/unit/branding.test.js`:

```js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('GraphQL Debugger branding', () => {
  test('manifest name and action title', () => {
    const m = JSON.parse(read('manifest.json'));
    expect(m.name).toBe('GraphQL Debugger');
    expect(m.action.default_title).toBe('Toggle GraphQL Debugger');
    expect(m.description.length).toBeLessThanOrEqual(132);
    expect(m.name).not.toMatch(/apollo/i);
  });

  test('no "APQ Debugger" left in shipped sources', () => {
    for (const p of ['js/ui/index.js', 'js/sw/index.js', 'js/sw/messaging.js', 'frontend/devtools.html']) {
      expect(read(p)).not.toMatch(/APQ Debugger/);
    }
  });

  test('storage keys unchanged', () => {
    expect(read('js/sw/storage.js')).toMatch("'apqPatterns'");
    expect(read('js/shared/constants.js')).toMatch("'apqHashRegistry'");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/branding.test.js`
Expected: FAIL on manifest name.

- [ ] **Step 3: Apply the strings**

- `manifest.json` `name`: `GraphQL Debugger`; `action.default_title`: `Toggle GraphQL Debugger`; `description`: `Debug GraphQL in DevTools: pause and edit requests, reveal Apollo APQ queries, explore the schema.` (≤132 chars).
- `package.json` `description`: `GraphQL Debugger: a Chrome DevTools extension for breakpoints, APQ recovery and schema exploration`.
- Panel title (`chrome.devtools.panels.create`), `<title>`, `main aria-label`, notification `title`: `GraphQL Debugger`. Notification message: `No URL patterns configured. Open DevTools > GraphQL Debugger to add patterns.`
- Context menu: `Toggle GraphQL Debugger`. Logs/comments: replace the name.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx jest` — Expected: all suites PASS (existing tests unchanged).
Run: `npm run build && npm run test:e2e` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json js frontend build-enhanced.js install-deps.js tests
git commit -m "feat: rename extension to GraphQL Debugger"
```

### Task 2: Store listing, policy and docs

**Files:**
- Modify: `store/store-description.md`, `store/privacy-policy.md` (name only — the analytics rewrite is in plan 3), `store/permissions-justification.md`
- Modify: `README.md`, `PRODUCT.md`, `DESIGN.md`, `CONTRIBUTING.md`, `CLAUDE.md` (Project section), `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Rewrite `store/store-description.md`**

Title line: `GraphQL Debugger: breakpoints, APQ & schema`. Short description (≤132 chars): `Pause and edit GraphQL requests, reveal the full query behind Apollo APQ hashes, and explore the schema — right in DevTools.` Detailed description leads with "APQ Debugger is now GraphQL Debugger", then: works on network traffic so it works with any client (Apollo Client, Relay, urql and more) on any site; features list in this order — request breakpoints (pause, edit query/variables/headers, resume), APQ recovery (active + passive), schema loading, copy as cURL, export. Do not list breakpoints as available until plan 2 is merged — mark that bullet with `<!-- breakpoints: enable when plan 2 lands -->` if this task ships first; plan 2's last task removes the marker.

- [ ] **Step 2: Verify the short description length**

Run: `node -e "const s=require('fs').readFileSync('store/store-description.md','utf8').split('## Short Description')[1].split('\n').filter(Boolean)[1]; console.log(s.length)"`
Expected: a number ≤ 132.

- [ ] **Step 3: Update the other docs**

- `PRODUCT.md`: Brand Commitments name → GraphQL Debugger; Users → "developers and testers working on web apps that use GraphQL (APQ users first)"; Product Purpose and Positioning per spec "Intent" (network-level, any client, can change traffic). Leave principle 5 for plan 3.
- `README.md`, `CONTRIBUTING.md`, `DESIGN.md`, `CLAUDE.md` Project paragraph, privacy policy and permissions justification: replace the product name; keep descriptions of APQ behaviour as they are.
- `CHANGELOG.md`: add an `## Unreleased` section with "Renamed: APQ Debugger is now GraphQL Debugger."

- [ ] **Step 4: Verify no stale name in docs**

Run: `git grep -n "APQ Debugger" -- ':!CHANGELOG.md' ':!.impeccable' ':!store/promo/video' ':!docs/superpowers'`
Expected: only lines in `scripts/promo/` (handled in Task 3).

- [ ] **Step 5: Commit**

```bash
git add store README.md PRODUCT.md DESIGN.md CONTRIBUTING.md CLAUDE.md CHANGELOG.md
git commit -m "docs: rename to GraphQL Debugger in store listing and docs"
```

### Task 3: Promo stage and tiles

**Files:**
- Modify: `scripts/promo/stage.html` (lines 4, 12, 562, 583, 585, 597, 601, 603), `scripts/promo/tiles.html` (11, 254, 267, 278), `scripts/promo/record-demo.js` (119, 136, 231, 235 — strings only; do not run it)

**Interfaces:** none.

- [ ] **Step 1: Replace the name** in those files. Tile `<small>` stays `for Chrome DevTools`. Card taglines: `Pause, edit and read every GraphQL request.` replaces `See the GraphQL behind every persisted-query hash.`; the infobar mock reads `“GraphQL Debugger” started debugging this browser`.

- [ ] **Step 2: Regenerate screenshots and tiles**

Run: `npm run build && npm run promo:screens`
Expected: files in `store/promo/screenshots/` and `store/promo/tiles/` updated; open two and confirm the panel tab and tiles say GraphQL Debugger.

- [ ] **Step 3: Verify**

Run: `git grep -n "APQ Debugger" -- scripts frontend js manifest.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/promo store/promo/screenshots store/promo/tiles
git commit -m "chore: rebrand promo stage, tiles and screenshots"
```
