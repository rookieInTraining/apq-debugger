# GraphQL Debugger — rename, request breakpoints, opt-in analytics

Date: 2026-11-04 · Status: draft for approval

## Intent and the why

The extension (today "APQ Debugger", store name "Apollo GraphQL Persisted Queries (APQ) Debugger") has ~70 users. Apollo Client Devtools has 200k+. The gap is reach: "APQ" is only searched for by people who already know the problem. The product is being repositioned as a general **GraphQL debugging tool for developers and testers working on web apps**, with APQ recovery kept as the core, distinctive feature.

The edge, versus Apollo Client Devtools and the GraphQL traffic viewers already listed (GraphQL DevTools, Graphql Devtools, GraphQL Inspector, GraphQeLves, graphql-network-inspector, Saturn): this tool works on network traffic through the Chrome debugger, so it works with any client on any site, and it can *change* traffic. None of the GraphQL extensions surveyed offer request breakpoints or APQ recovery.

This release ships three things together:

1. **Rename** to **GraphQL Debugger**.
2. **Request breakpoints** — the headline feature of the new name.
3. **Opt-in in-extension usage analytics** — so the owner can see whether the rename and features land.

Later releases, each with its own design (not in scope here): edit-and-resend of captured requests; more copy-as formats (bash/PowerShell curl exist; add browser `fetch`/XHR etc.).

### Success

More installs, more store reviews, and real feature-usage data from users who opt in to analytics.

## Goals

- A user can make a named GraphQL operation's request pause the moment it is sent, edit its query, variables or headers, and resume so the edited request goes out in the same page session and the app reacts to the real response.
- A user can catch an unexpected request with a one-shot "pause on next request".
- Every user-facing surface says GraphQL Debugger; APQ remains the lead feature in the copy.
- Users who opt in send feature-level usage events to the owner's Google Analytics.

## Non-goals

- Firefox (or any non-Chromium browser). Firefox has no `chrome.debugger` equivalent, so it cannot hold or rewrite request bodies in flight; revisit later.
- Editing responses (mocking). Breakpoints are request-side only.
- Edit-and-resend from the request history, new copy-as formats (later releases).
- Renaming the repo, npm package, or internal identifiers (`apq-debugger` in `package.json`, storage keys, module names). User-facing strings only.
- A new store listing. The existing listing and extension ID are renamed so current users and reviews carry over.

## Anti-goals (failure even if it technically works)

- **Any UI/UX change that diminishes the existing experience.** The Requests and Schema tabs, the patterns pane, infobar, filters, detail pane, copy-as-cURL, export, keyboard shortcuts and docked-size behaviour must feel exactly as good as today. Breakpoints are additive.
- **Any regression of existing functionality** — active mode, passive mode, hash registry, schema loading, endpoint tracking, SW-restart recovery, toolbar toggle. With debug mode off and no breakpoints, behaviour is identical to 4.0.0.
- Analytics that sends anything derived from traffic, or that sends anything before the user said yes.
- A name or listing that reads as Apollo's own product.

## Constraints

- Chrome/Chromium only, MV3, `minimum_chrome_version` 123 (unchanged unless a needed CDP feature forces a bump — call it out if so).
- All rules in `CLAUDE.md` and `PRODUCT.md` hold: DevTools-native look (system UI font 12px, `ui-monospace` only for code/hashes/URLs, 1px dividers, colour carries state only and never alone, never cancel `:focus-visible`, sentence-case copy, one-word status vocabulary), MV3 SW-restart safety (must-survive state in `chrome.storage`), messaging convention (`tabId` broadcast + `validateMessage`), promise-wrapped Chrome APIs via `chrome-api.js`, JSDoc on exports, `chrome.runtime.lastError` handled everywhere.
- WCAG 2.2 AA as in `PRODUCT.md` (full keyboard operation of the new tab included).
- Uncommitted work in `store/promo/video/` (demo video, poster, `demo-script.md`) belongs to the owner — build on it, don't overwrite it blindly.

---

## Part 1 — Rename to GraphQL Debugger

Decided:

- Name: **GraphQL Debugger**. Not "GraphQL DevTools" (already taken by at least two listings), not "Apollo GraphQL DevTools" (Apollo trademark; reads as Apollo's product; risks takedown; narrows to one client).
- Store title with keywords, e.g. *"GraphQL Debugger: breakpoints, APQ & schema"*. Apollo is mentioned only factually in the description/tagline ("works with Apollo Client, Relay, urql and more"; "reveal Apollo APQ queries").
- Same listing, same extension ID.

Surfaces to change (builder to sweep for the rest): `manifest.json` `name` (currently contains "Apollo"), `action.default_title`; `chrome.devtools.panels.create` title in `js/ui/index.js`; `<title>` and `aria-label`s in `frontend/devtools.html`; context-menu and notification strings; `README.md`; `store/store-description.md`, `store/privacy-policy.md`, `store/permissions-justification.md`; `PRODUCT.md` (name, users, purpose, positioning, principle 5 — see Part 3); `DESIGN.md` if it names the product; promo screenshots/tiles/video via `npm run promo:*`, and `store/promo/video/demo-script.md` updated to show breakpoints.

Icon: unchanged unless the builder finds it APQ/Apollo-specific — *builder's call, flag to owner if changing.*

## Part 2 — Request breakpoints

### Model

- **URL patterns** (existing patterns pane) still decide which endpoints are intercepted. Unchanged.
- **Operation breakpoints**: a list of operation names, entered by typing into a list that looks and behaves like the patterns pane (add field, remove, persisted to `chrome.storage.local`). Each entry has an enable/disable toggle (filled/hollow dot, as in Sources).
- **Debug mode**: a toggle. When on (active mode; see the passive-mode exception below), a request matching the URL patterns whose operation name matches an enabled breakpoint **and which carries full query text** pauses. Hash-only APQ requests never pause — in active mode they are about to fail on purpose and be retried with the full query; the retry is what pauses, so the user always pauses on something readable and editable.
- **Operation name** comes from the body's `operationName`; if absent, it is parsed from the query text (the operation definition's name; for a multi-operation document with no `operationName`, the builder decides). Anonymous operations can only be caught by "pause on next".
- **Pause on next request**: a one-shot button. The next GraphQL request carrying full query text that reaches the interceptor pauses, regardless of operation breakpoints, then the one-shot clears. (It can only see requests on URLs matched by the patterns, since only those are intercepted — the UI copy must not imply otherwise.)
- Debug mode works in both active and passive interception. Starting interception remains a prerequisite; debug mode with interception off does nothing (UI should make that clear).
- **Passive mode exception (owner's decision):** in passive mode the app only sends hash-only requests for registered queries, so in passive mode a matching **hash-only request also pauses**. Its operation name comes from `operationName` or the registry entry. The Query sub-tab is filled from the hash registry.
  - Query not edited → the request goes out hash-only as it came, with only the variable/header edits applied (passive mode still doesn't rewrite anything the user didn't edit).
  - Query edited → the request goes out as a full query (`query` + recomputed `sha256Hash`) (*Claude's call* on the exact shape).
  - Hash not in registry → it still pauses if the name matches. The Query sub-tab says "Not in registry" and is read-only, but variables and headers can still be edited (*Claude's call*).
  - "Pause on next request" in passive mode also catches hash-only requests.
  - In active mode, hash-only requests still never pause; the full-query retry does.
- **Breakpoints only fire while a GraphQL Debugger panel for that tab is open** (*Claude's call*). Interception can run with no panel (toolbar button / context menu); in that case nothing pauses, because the app's request would hang with no UI to release it. The SW needs reliable per-tab panel presence (e.g. a `runtime.connect` port per tab, re-established after SW restarts). The operation-breakpoint list persists in `chrome.storage.local`; the debug-mode toggle and the pause-on-next one-shot are per tab and live in `chrome.storage.session` (cleared on browser exit).

### When a breakpoint hits

- **Only the request is held; the page is not frozen** (owner's decision — an earlier "freeze the whole page" idea was dropped). The page's JS keeps running, but the UI and code that depend on that response are naturally stuck waiting for it, which is the effect the owner wants. No `Debugger`-domain pause, no "Paused in debugger" overlay.
- If the page gives up on the request while it is held (its own timeout / `AbortController`, or navigation), the paused item shows that ("Cancelled by page") and leaves the queue; it is not resent.
- The panel **switches to the Breakpoints tab automatically**; the yellow infobar reads e.g. "Paused on GetCart" / "Paused · 2 requests waiting"; the tab-strip status shows a pause state (needs a word — e.g. "Paused" added to the status vocabulary — and a shape, per the design rules).
- Several requests can be paused at once (a burst, or a batched array body — one HTTP request containing several operations is one paused item). They queue in the paused list; the user handles them one by one.

### Breakpoints tab (layout B, chosen by the owner from mockups)

A third tab after Requests and Schema, modelled on the Sources panel:

- **Left column**: "Paused" list (requests waiting, selected one highlighted) above "Breakpoints" list (operation names with toggles, add/remove). Debug-mode toggle and "Pause on next request" live in this tab's toolbar.
- **Right**: editor for the selected paused request with sub-tabs **Query**, **Variables**, **Headers**. Edited sub-tabs/fields show an "edited" marker (word or shape, not colour alone).
- **Actions**: **Resume this** (sends with edits), **Resume all** (F8), **Revert edits**, **Fail request** (aborts it so the app sees a network error). Revert/Fail/Resume-all were proposed by Claude and accepted with the layout; the owner may trim.
- Same DevTools-native styling, density handling and narrow-width behaviour as the rest of the panel.

### Resume semantics

- Resume sends the request with the edited body/headers via `Fetch.continueRequest` (body as base64 `postData`, plus `headers` when edited). Other paused requests stay held until handled.
- **Editing the query of an APQ retry**: the retry carries both `query` and `extensions.persistedQuery.sha256Hash`; Apollo Server rejects a hash that doesn't match the query. If the query text was edited, recompute the SHA-256 of the new query and replace the hash (*Claude's call*; the existing `hash.js` digest helper applies). Do not register edited queries in the hash registry under the original hash.
- Invalid JSON in Variables/Headers blocks Resume this with an inline error; it never sends a malformed body silently.
- If the panel closes, the tab navigates/closes, or interception stops while requests are paused: all paused requests are continued unmodified — never leave a request held with no UI to release it (*Claude's call*).

### Risks to check early

1. ~~Freezing page JS from the extension's debugger session while Chrome DevTools is open.** The panel lives inside DevTools, so DevTools' own debugger session is attached too. Pausing JS (e.g. `Debugger.enable` + `Debugger.pause`, or an equivalent) may make DevTools itself jump to Sources and show its own paused UI, may not show the overlay if the page is idle, or may conflict on resume. Spike this before building UI. If a clean full-page freeze is not achievable, come back to the owner — do not silently fall back to "only the request waits".~~ Dropped: the page is not frozen.
2. MV3 service-worker lifetime while requests are paused (paused state must survive or be safely recoverable; `chrome.storage.session` is the right lifetime for the paused queue).
3. Any CDP domain beyond `Fetch` that this needs, and whether it changes the "is debugging this browser" behaviour or requires a Chrome version bump.

## Part 3 — Opt-in usage analytics

Decided:

- **Opt-in.** After updating (and on first install), the panel shows a single, dismissible prompt — "Help improve GraphQL Debugger?" with what is sent and a link to the privacy policy. Nothing is sent until the user says yes. A settings toggle turns it on/off at any time. Declining or dismissing is remembered; don't re-prompt (*Claude's call*).
- **Feature-level events only**, to the owner's existing Google Analytics. Examples: interception started (active/passive), breakpoint hit, resumed with edits, pause-on-next used, schema loaded, copied as cURL (format), export used, theme/density chosen. Builder finalises the event list.
- **Never sent**: URLs, hostnames, operation names, queries, variables, headers, hashes, schema contents, or anything else derived from traffic or the inspected page. No user identifiers beyond a random install ID.
- Transport: GA4 Measurement Protocol from the service worker is the likely fit (no remote scripts, consistent with "no network-loaded scripts") — *builder's call*.
- Policy/disclosure: rewrite `store/privacy-policy.md` (it currently promises no analytics), update the store's privacy-practices disclosure, and amend `PRODUCT.md` principle 5 to: *nothing from your traffic leaves the browser; anonymous feature usage is sent only if you opt in.*

Needed from the owner before this part ships: the GA4 measurement ID and Measurement Protocol API secret (or confirmation of which GA property to use).

## Release

- One release containing all three parts. Version number per the existing `npm version` flow (4.0.0 is already tagged, so this is at least the next major — *builder's call*).
- "What's new" copy in the store description/CHANGELOG should explain the rename to existing users ("APQ Debugger is now GraphQL Debugger").

## Testing expectations

- Unit tests for: passive-mode hash-only pausing (resolved, unresolved, query edited vs not); operation-name extraction (body field, parsed from query, anonymous, batched), breakpoint matching, pause-on-next one-shot, hash recompute on edited query, resume/fail/revert, cleanup on detach/navigation, analytics gating (nothing sent before opt-in; no traffic-derived fields ever in payloads).
- Existing unit and Playwright e2e suites pass unchanged (anti-goal: no regressions). Add an e2e for: breakpoint hits → request held → edit variable → resume → page receives response to edited request.

## Left to the builder

State/message shapes, file/module split (one responsibility per module), event names, exact copy beyond the decided strings, how operation names are parsed (a small parser vs. regex — the `graphql` package must stay out of the SW bundle), keyboard shortcuts beyond F8.
