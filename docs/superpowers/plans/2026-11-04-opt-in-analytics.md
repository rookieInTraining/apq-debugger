# Opt-in Usage Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users who opt in send anonymous, feature-level usage events to the owner's Google Analytics 4 property; nobody else sends anything, and nothing derived from traffic ever leaves the browser.

**Architecture:** One service-worker module (`js/sw/analytics.js`) owns consent, the install ID and sending, via the GA4 Measurement Protocol (`fetch` from the SW — no remote scripts). Every event name and parameter value is checked against a fixed allowlist in `js/shared/analytics-events.js`, so traffic-derived strings cannot be sent even by mistake. The panel shows a one-time consent notice and a settings toggle, and forwards UI events to the SW with a `trackEvent` message. The measurement ID and API secret are injected at build time from environment variables; when they are absent (dev builds, forks, CI) analytics is fully off and no prompt is shown.

**Tech Stack:** Chrome MV3, GA4 Measurement Protocol, esbuild `define`, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-graphql-debugger-design.md` (Part 3). Plan 3 of 3; runs on branch `graphql-debugger` after the breakpoints plan (it instruments breakpoint events).

## Global Constraints

- **Opt-in.** Nothing is sent until consent is `granted`. Consent values: unset → prompt; `granted`; `denied`. Declining *or dismissing* stores `denied`; never re-prompt.
- **Never sent:** URLs, hostnames, operation names, queries, variables, headers, hashes, schema contents, endpoint paths, error messages, or anything derived from traffic or the inspected page. Only allowlisted event names with enum-valued params.
- Identifiers: a random UUID install ID (`crypto.randomUUID()`) in `chrome.storage.local`, a random per-browser-session ID in `chrome.storage.session`. Both deleted when consent is withdrawn.
- No network-loaded scripts; no new permissions (`<all_urls>` host permission already covers `https://www.google-analytics.com/`).
- Config: `GA_MEASUREMENT_ID` and `GA_API_SECRET` environment variables at build time; never committed. Empty → analytics disabled (no prompt, no settings row, `trackEvent` no-op).
- Failures (offline, blocked, non-2xx) are swallowed silently with `console.debug` — no retries, no queue, no user-visible errors.
- Panel design rules from `CLAUDE.md` (DevTools-native, sentence case, colour never alone, focus visible).

## Review Focus

1. **A developer accidentally passes a URL/operation name as a param** (e.g. `trackEvent('copy', { what: req.operationName })`): must be dropped, not sent. Test in Task 1 (allowlist rejects non-enum values).
2. **User withdraws consent**: sending stops immediately, install/session IDs deleted. Test in Task 2.
3. **Unconfigured build** (no env vars — every dev and CI build): no prompt, no fetch. Test in Task 2 and Task 3.
4. **Offline / GA blocked by an ad blocker**: no error toast, no unhandled rejection in the SW. Test in Task 2.
5. **Multiple DevTools panels open on different tabs**: the prompt answered in one panel disappears from the others and is never shown again. Test in Task 3 (`ANALYTICS_UPDATED` broadcast).

---

### Task 1: Event allowlist

**Files:**
- Create: `js/shared/analytics-events.js`
- Test: `tests/unit/analytics-events.test.js`

**Interfaces:**
- Produces: `ANALYTICS_EVENTS: Record<string, Record<string, string[]>>` and `sanitizeEvent(name: string, params?: object): { name: string, params: Record<string,string> } | null`.

The allowlist (exact):

| Event | Params (allowed values) |
|-------|------------------------|
| `panel_open` | — |
| `interception_start` | `mode`: `active`,`passive`; `trigger`: `panel`,`toolbar` |
| `interception_stop` | `trigger`: `panel`,`toolbar`,`chrome` |
| `debug_mode_set` | `on`: `yes`,`no` |
| `pause_next_armed` | — |
| `breakpoint_hit` | `reason`: `breakpoint`,`pause_next`; `mode`: `active`,`passive` |
| `paused_resume` | `edited`: `yes`,`no` |
| `paused_resume_all` | — |
| `paused_fail` | — |
| `schema_load` | `result`: `success`,`error`; `source`: `observed`,`guessed`,`manual` |
| `copy` | `what`: `query`,`variables`,`hash`,`curl_bash`,`curl_powershell` |
| `export_history` | — |
| `settings_change` | `theme`: `system`,`light`,`dark`; `density`: `comfortable`,`compact` |
| `analytics_opt_in` | — |

- [ ] **Step 1: Write the failing tests:**

```js
import { sanitizeEvent } from '../../js/shared/analytics-events.js';

test('passes an allowlisted event with allowed values', () => {
  expect(sanitizeEvent('copy', { what: 'curl_bash' })).toEqual({ name: 'copy', params: { what: 'curl_bash' } });
});
test('rejects unknown events', () => {
  expect(sanitizeEvent('page_view', {})).toBeNull();
});
test('drops params with values outside the enum', () => {
  expect(sanitizeEvent('copy', { what: 'https://api.example.com/graphql' })).toEqual({ name: 'copy', params: {} });
  expect(sanitizeEvent('copy', { what: 'GetCart' })).toEqual({ name: 'copy', params: {} });
});
test('drops unknown param keys', () => {
  expect(sanitizeEvent('panel_open', { url: 'x', operationName: 'GetCart' })).toEqual({ name: 'panel_open', params: {} });
});
test('non-string values are dropped', () => {
  expect(sanitizeEvent('debug_mode_set', { on: true })).toEqual({ name: 'debug_mode_set', params: {} });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx jest tests/unit/analytics-events.test.js` → FAIL.
- [ ] **Step 3: Implement** the table as a frozen object and `sanitizeEvent`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: analytics event allowlist"` (add files first).

### Task 2: Service-worker analytics module and build config

**Files:**
- Create: `js/sw/analytics.js`
- Modify: `build-enhanced.js` (`esbuild.build` gets `define`), `js/shared/constants.js`, `js/sw/messaging.js` (validate + route), `js/sw/index.js`, `.github/workflows/release.yml` (pass secrets as env to the build step), `tests/unit/setup.js` (`global.fetch = jest.fn()`, `crypto.randomUUID`)
- Test: `tests/unit/analytics.test.js`

**Interfaces:**
- Build-time globals: `__GA_MEASUREMENT_ID__`, `__GA_API_SECRET__` (strings; `''` when env unset). In Jest, define them on `global` in each test (`typeof` guard in the module: `typeof __GA_MEASUREMENT_ID__ === 'string' ? … : ''`).
- Constants: `ANALYTICS_CONSENT_STORAGE_KEY = 'gqlAnalyticsConsent'`, `ANALYTICS_CLIENT_ID_STORAGE_KEY = 'gqlAnalyticsClientId'`, `ANALYTICS_SESSION_STORAGE_KEY = 'gqlAnalyticsSession'`, `GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect'`.
- Produces:
  - `isAnalyticsConfigured(): boolean`
  - `getConsent(): Promise<'granted'|'denied'|null>`
  - `setConsent(value: 'granted'|'denied'): Promise<void>` — on `granted` creates the client ID and sends `analytics_opt_in`; on `denied` removes client and session IDs. Broadcasts `{ status: 'ANALYTICS_UPDATED', consent }` (no `tabId` — applies to every panel).
  - `trackEvent(name: string, params?: object): Promise<void>` — no-op unless configured and `granted`; `sanitizeEvent` → POST.
- Request (exact shape): `POST ${GA_ENDPOINT}?measurement_id=${id}&api_secret=${secret}` body `{ client_id, user_properties: { extension_version: {value}, browser_major: {value}, os: {value}, ui_language: {value} }, events: [{ name, params: { ...params, session_id, engagement_time_msec: 100 } }] }`. `extension_version` from `chrome.runtime.getManifest().version`; `browser_major` from `navigator.userAgentData?.brands` (Chromium/Google Chrome major) else the `Chrome/(\d+)` UA match; `os` from `chrome.runtime.getPlatformInfo()`; `ui_language` from `chrome.i18n.getUILanguage()`.
- Messages: `{ getAnalyticsState: true }` → `{ status: 'SUCCESS', configured, consent }`; `{ setAnalyticsConsent: 'granted'|'denied' }` → same shape; `{ trackEvent: { name: string, params?: object } }` → `{ status: 'SUCCESS' }`. `validateMessage` rejects other types/values. Add `ANALYTICS_UPDATED` to `handleMessage`'s ignore list.
- SW-side emit points: `interception_start`/`interception_stop` in `attachDebuggerToTab`/`detachDebuggerFromTab` callers (`messaging.js`: `trigger: 'panel'` from the patterns message, `'toolbar'` from `toggleDebuggerFromAction`; `onDetach` with `canceled_by_user` → `'chrome'`); `breakpoint_hit` after a successful `holdRequest`; `paused_resume` / `paused_resume_all` / `paused_fail` / `debug_mode_set` / `pause_next_armed` in the breakpoint message handlers; `schema_load` in `handleLoadSchemaMessage` (`manual` when `message.url` given, else `observed` if the endpoint came from the tracker, else `guessed`).

- [ ] **Step 1: Write the failing tests:**
  - Not configured (`__GA_MEASUREMENT_ID__ = ''`): `trackEvent('panel_open')` never calls `fetch`; `getAnalyticsState` returns `configured: false`.
  - Configured, consent unset → no `fetch`; `denied` → no `fetch`.
  - `setConsent('granted')` → `fetch` called once with event `analytics_opt_in`, URL contains `measurement_id=G-TEST&api_secret=S`, body `client_id` is the stored UUID.
  - Granted: `trackEvent('copy', { what: 'GetCart' })` sends `params` with only `session_id` and `engagement_time_msec` (the bad value is dropped); body JSON contains none of `GetCart`, `http`, `graphql`.
  - `trackEvent('page_view')` → no `fetch`.
  - `setConsent('denied')` after granted → `chrome.storage.local.remove` called with `gqlAnalyticsClientId`, session key removed; subsequent `trackEvent` → no `fetch`.
  - `fetch` rejects → `trackEvent` resolves, no throw.
  - Client ID is reused across calls (one `randomUUID` call).
  - `handleMessage` routes `trackEvent` and validates (`trackEvent: 'x'` → ERROR, `setAnalyticsConsent: 'maybe'` → ERROR).
  - Attaching from the panel emits `interception_start` with `{ mode: 'active', trigger: 'panel' }`; a held request emits `breakpoint_hit` with `{ reason: 'breakpoint', mode: 'active' }`.
- [ ] **Step 2: Run to verify they fail** — `npx jest tests/unit/analytics.test.js`.
- [ ] **Step 3: Implement.** In `build-enhanced.js` add to `esbuild.build`: `define: { __GA_MEASUREMENT_ID__: JSON.stringify(process.env.GA_MEASUREMENT_ID || ''), __GA_API_SECRET__: JSON.stringify(process.env.GA_API_SECRET || '') }`. In `release.yml`, the "Build extension" step gets `env: GA_MEASUREMENT_ID: ${{ secrets.GA_MEASUREMENT_ID }}` and `GA_API_SECRET: ${{ secrets.GA_API_SECRET }}`. `ci.yml` unchanged (stays unconfigured).
- [ ] **Step 4: Run** `npx jest` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: opt-in analytics in the service worker"`

### Task 3: Consent notice, settings toggle and UI events

**Files:**
- Create: `js/ui/analytics-consent.js`
- Modify: `frontend/devtools.html` (notice row directly under the tab strip: `<div class="notice hidden" id="analytics-notice" role="region" aria-label="Usage data">`; settings popover gets a third `fieldset` "Usage data" with checkbox `#analytics-toggle`), `frontend/css/components.css`, `js/ui/index.js` (init, `panel_open`, `ANALYTICS_UPDATED`), `js/ui/request-detail.js` (copy events), `js/ui/curl-copy.js` (copy events), `js/ui/toolbar.js` (`export_history`), `js/ui/settings.js` (`settings_change`)
- Test: `tests/unit/analytics-consent.test.js` (jsdom)

**Interfaces:**
- Consumes: messages from Task 2.
- Produces: `initAnalyticsConsent(): void`, `track(name: string, params?: object): void` (fire-and-forget `trackEvent` message, `lastError` ignored).

Exact copy:
- Notice text: `Help improve GraphQL Debugger? Send anonymous feature usage — never URLs, queries, variables or headers.` Link `What's sent` → opens the privacy policy URL on GitHub (`https://github.com/rookieInTraining/apq-debugger/blob/trunk/store/privacy-policy.md`) via `chrome.tabs.create`. Buttons: `Allow` (primary), `No thanks`; close button `aria-label="Dismiss"` (= No thanks).
- Settings: legend `Usage data`, checkbox label `Send anonymous usage data`.

- [ ] **Step 1: Write the failing tests:**
  - State `{ configured: true, consent: null }` → notice visible; settings row visible, unchecked.
  - `Allow` → sends `setAnalyticsConsent: 'granted'`, notice hidden, checkbox checked.
  - `No thanks` and `Dismiss` → each send `setAnalyticsConsent: 'denied'`, notice hidden.
  - `{ configured: true, consent: 'denied' }` → notice hidden.
  - `{ configured: false }` → notice hidden and settings fieldset hidden; `track()` sends nothing.
  - Toggling the checkbox sends the matching consent value.
  - `ANALYTICS_UPDATED` broadcast with `consent: 'granted'` hides a visible notice and checks the box.
  - Copy query button → `trackEvent: { name: 'copy', params: { what: 'query' } }`; cURL PowerShell copy → `what: 'curl_powershell'`.
  - `devtools.test.js` and `curl-copy.test.js` still pass.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** `track()` only sends when the last known state is configured + granted (saves message traffic); the SW still enforces.
- [ ] **Step 4: Run** `npx jest && npm run build && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: analytics consent notice and settings toggle"`

### Task 4: Privacy policy, product docs, release checklist

**Files:**
- Modify: `store/privacy-policy.md`, `store/permissions-justification.md` (host permission also used to send opt-in analytics to google-analytics.com), `PRODUCT.md` (principle 5), `README.md` (Privacy section), `CHANGELOG.md`, `CLAUDE.md` (Architecture: analytics module and build env vars)
- Create: `docs/release-checklist-5.0.md`

- [ ] **Step 1: Rewrite `store/privacy-policy.md`**: "Last updated" date; Data Collection section states that by default nothing is collected; with opt-in, the exact event table from Task 1 plus the user properties (extension version, browser major version, OS, UI language), the random install ID and session ID, sent to Google Analytics 4 (Google as processor); the full "never sent" list from Global Constraints; how to turn it off (settings toggle) and that turning it off deletes the IDs; Third-Party Services names Google Analytics (opt-in only). Remove "Does **not** collect analytics or telemetry" and "Does **not** transmit any data to external servers", replace with the opt-in wording.
- [ ] **Step 2: `PRODUCT.md` principle 5** → `Local first: nothing from your traffic leaves the browser; anonymous feature usage is sent only if you opt in.`
- [ ] **Step 3: Write `docs/release-checklist-5.0.md`** for the owner: create GitHub secrets `GA_MEASUREMENT_ID`, `GA_API_SECRET` (GA Admin → Data streams → Measurement Protocol API secrets); verify one event in GA DebugView using a local build with env vars set and the `/debug/mp/collect` endpoint; update the Web Store dashboard Privacy practices (declare "Web history: no", "User activity: yes — anonymous feature usage, opt-in", certify limited use); update the listing name/title/description from `store/store-description.md`; upload the new screenshots/tiles/video; `npm version major`; `git push --follow-tags`.
- [ ] **Step 4: Verify** — `git grep -n "does not collect analytics" -i -- store README.md PRODUCT.md` → no output; `npx jest && npm run lint` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "docs: privacy policy and release checklist for opt-in analytics"`
