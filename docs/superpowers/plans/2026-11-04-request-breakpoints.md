# Request Breakpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can pause a GraphQL request by operation name (or "pause on next"), edit its query, variables or headers on a new Breakpoints tab, and resume it so the edited request goes out in the same page session.

**Architecture:** The service worker already holds every matching request in `Fetch.requestPaused`. A new decision step in `interceptor.js` asks `breakpoints.js` whether to keep holding it; if so `pause-queue.js` records it (mirrored to `chrome.storage.session`) instead of calling `Fetch.continueRequest`. The panel keeps a long-lived port open per tab (`panel-presence.js`) — pausing only happens while that port is connected, and a disconnect releases everything for the tab. The panel's new Breakpoints tab renders the paused queue and breakpoint list and sends resume/fail messages. The page is never frozen; only the request waits.

**Tech Stack:** Chrome MV3, Chrome DevTools Protocol `Fetch` (+ `Network` for cancellation), esbuild, Jest (node + jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-graphql-debugger-design.md` (Part 2). Plan 2 of 3; runs on branch `graphql-debugger` after the rename plan.

## Global Constraints

- With debug mode off, no breakpoints and no pause-on-next, behaviour is identical to 4.0.0 — `handleFetchRequestPaused` must take the existing code path unchanged. Anti-goal: no regression, no UI/UX degradation of Requests/Schema.
- Only the request is held. No `Debugger` domain, no `Overlay`, no page-JS pause.
- Pausing happens only while a panel for that tab is connected.
- Active mode: hash-only requests never pause (they are contaminated as today); the full-query retry pauses. Passive mode: matching hash-only requests pause too.
- Never leave a request held with no UI: panel disconnect, navigation, tab close, or stopping interception continues every held request for that tab unmodified.
- Edited queries: recompute `extensions.persistedQuery.sha256Hash` with `digestMessage` (`js/sw/hash.js`) when the request carries a persistedQuery extension. Do not register edited queries in the hash registry.
- Invalid JSON in Variables/Headers blocks resume with an inline error.
- Storage: breakpoint list in `chrome.storage.local`; per-tab debug mode, pause-on-next and the paused queue in `chrome.storage.session`.
- `graphql` npm package stays out of the SW bundle; no new runtime dependencies.
- Design rules from `CLAUDE.md`: DevTools-native, system UI 12px, `ui-monospace` only for code/hashes/URLs, 1px dividers, colour carries state only and never alone (each state has a word and a shape), never cancel `:focus-visible`, sentence case. Status vocabulary gains exactly one word: `Paused`.
- Conventions: promise-wrap Chrome APIs via `chrome-api.js`; JSDoc on exports; `chrome.runtime.lastError` handled in every callback; `JSON.parse` in try/catch; new panel→SW messages validated in `validateMessage`; SW→panel broadcasts carry `tabId`.
- Keyboard: F8 = Resume all while anything is paused (DevTools convention). Breakpoints tab is fully keyboard-operable (tabs arrow keys include it).
- Bundle budgets in `scripts/check-bundle-size.js` may be raised to the measured size + 10%, no more.

## Review Focus

1. **Page aborts a held request** (its own timeout/`AbortController`, or navigation): the item must show "Cancelled by page" and never be resent; resuming it must not throw. Test in Task 3 (`markCancelled` + continue-error path).
2. **Service worker restarts while requests are held**: the queue must reload from `storage.session` and Resume must still work (Chrome keeps the request paused). Test in Task 3 (`ensurePausedLoaded`).
3. **Burst of matching requests / batched array body**: N held items for N HTTP requests; one item with several operations for a batch; editing one operation in a batch leaves the others byte-identical. Test in Task 4 (`buildResumedBody`).
4. **Request with no `operationName`, anonymous query, or multi-operation document**: name parsed from the query when unambiguous, otherwise anonymous — anonymous only pauses via pause-on-next. Test in Task 1.
5. **Panel closed with requests held / interception stopped**: every held request continued unmodified and the queue cleared. Test in Task 5.

---

## File structure

| File | Responsibility |
|------|----------------|
| `js/shared/operation-name.js` (new) | Derive an operation name from a GraphQL payload. |
| `js/shared/constants.js` | New storage keys and limits. |
| `js/sw/breakpoints.js` (new) | Breakpoint list, per-tab debug mode / pause-on-next, and the pause decision. |
| `js/sw/pause-queue.js` (new) | Held requests per tab: hold, list, resume, fail, release, cancel; persisted to `storage.session`. |
| `js/sw/resume-body.js` (new) | Pure: apply edits to a held body (incl. hash recompute) and build continue params. |
| `js/sw/panel-presence.js` (new) | Track connected panels per tab via `runtime.onConnect`. |
| `js/sw/interceptor.js` | Call the pause decision; hand held requests to the queue. |
| `js/sw/messaging.js` | Validate and route breakpoint messages. |
| `js/sw/index.js` / `debugger-manager.js` | Wire presence, `Network.loadingFailed`, navigation/detach release. |
| `js/ui/tabs.js` (new) | Main tab switching for three tabs (moved out of `schema-viewer.js`). |
| `js/ui/panel-port.js` (new) | Open and re-open the presence port. |
| `js/ui/breakpoints-view.js` (new) | Breakpoints tab: toolbar, breakpoint list, paused list, infobar, auto-switch. |
| `js/ui/paused-editor.js` (new) | Query/Variables/Headers editor, edit tracking, validation, actions. |
| `frontend/devtools.html`, `frontend/css/components.css` | Markup and styles for the tab. |

---

### Task 1: Operation name extraction

**Files:**
- Create: `js/shared/operation-name.js`
- Test: `tests/unit/operation-name.test.js`

**Interfaces:**
- Produces: `extractOperationName(payload: object, registryEntry?: {operationName?: string}|null) => string` — returns `''` for anonymous/unknown.

- [ ] **Step 1: Write the failing test**

```js
import { extractOperationName } from '../../js/shared/operation-name.js';

describe('extractOperationName', () => {
  test('uses operationName field', () => {
    expect(extractOperationName({ operationName: 'GetCart', query: 'query X { a }' })).toBe('GetCart');
  });
  test('parses a named query', () => {
    expect(extractOperationName({ query: 'query GetCart($id: ID!) { cart(id: $id) { id } }' })).toBe('GetCart');
  });
  test('parses mutation and subscription', () => {
    expect(extractOperationName({ query: 'mutation AddItem { add }' })).toBe('AddItem');
    expect(extractOperationName({ query: '  subscription OnPrice { p }' })).toBe('OnPrice');
  });
  test('ignores fragment names and comments', () => {
    expect(extractOperationName({ query: '# query Fake\nfragment F on T { a }\nquery Real { ...F }' })).toBe('Real');
  });
  test('anonymous query and shorthand are empty', () => {
    expect(extractOperationName({ query: '{ cart { id } }' })).toBe('');
    expect(extractOperationName({ query: 'query { cart { id } }' })).toBe('');
  });
  test('multi-operation document without operationName is empty', () => {
    expect(extractOperationName({ query: 'query A { a } query B { b }' })).toBe('');
  });
  test('hash-only falls back to registry entry', () => {
    const p = { extensions: { persistedQuery: { sha256Hash: 'abc' } } };
    expect(extractOperationName(p, { operationName: 'GetUser' })).toBe('GetUser');
    expect(extractOperationName(p, null)).toBe('');
  });
  test('non-object payload is empty', () => {
    expect(extractOperationName(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest tests/unit/operation-name.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** `extractOperationName` in `js/shared/operation-name.js`. Order: non-empty string `payload.operationName` → else strip `#…` line comments and string literals from `payload.query`, collect matches of `/\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g` that sit at definition level (preceded by start-of-text or `}`, ignoring whitespace); exactly one operation definition in the document (count definitions including anonymous `query {`/`{` ones) and it is named → that name; else `''` → finally `registryEntry?.operationName || ''`.

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Commit** — `git add js/shared/operation-name.js tests/unit/operation-name.test.js && git commit -m "feat: extract GraphQL operation names"`

### Task 2: Breakpoint store and pause decision

**Files:**
- Modify: `js/shared/constants.js` (append)
- Create: `js/sw/breakpoints.js`
- Modify: `tests/unit/setup.js` (add `chrome.storage.session` mock with the same shape as `local`; add `chrome.runtime.onConnect: { addListener: jest.fn() }`)
- Test: `tests/unit/breakpoints.test.js`

**Interfaces:**
- Constants: `BREAKPOINTS_STORAGE_KEY = 'gqlBreakpoints'`, `DEBUG_STATE_STORAGE_KEY = 'gqlDebugState'`, `PAUSED_QUEUE_STORAGE_KEY = 'gqlPausedQueue'`, `MAX_BREAKPOINTS = 100`, `MAX_PAUSED_PER_TAB = 50`.
- Type `Breakpoint = { name: string, enabled: boolean }`.
- Produces:
  - `initBreakpoints(): Promise<void>` — loads list (local) and per-tab state (session); idempotent, returns the same promise on repeat calls.
  - `getBreakpoints(): Breakpoint[]`
  - `setBreakpoints(list: Breakpoint[]): Promise<Breakpoint[]>` — trims names, drops empty and duplicate names (first wins), caps at `MAX_BREAKPOINTS`, persists, returns the stored list.
  - `getDebugState(tabId: number): { debugMode: boolean, pauseNext: boolean }`
  - `setDebugMode(tabId: number, on: boolean): Promise<void>`
  - `setPauseNext(tabId: number, on: boolean): Promise<void>`
  - `clearDebugState(tabId: number): Promise<void>`
  - `decidePause(op: { operationName: string, isHashOnly: boolean }, ctx: { tabId: number, passive: boolean }): null | 'breakpoint' | 'pause-next'` — pure read of current state; does not consume pause-next.
  - `consumePauseNext(tabId: number): Promise<void>`

- [ ] **Step 1: Write the failing tests** (`tests/unit/breakpoints.test.js`, `beforeEach` resets module via `jest.isolateModules` and storage mocks):

```js
test('nothing pauses when debug mode is off and pause-next is off', async () => {
  await setBreakpoints([{ name: 'GetCart', enabled: true }]);
  expect(decidePause({ operationName: 'GetCart', isHashOnly: false }, { tabId: 1, passive: false })).toBeNull();
});
test('enabled breakpoint pauses a full-query request in active mode', async () => {
  await setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await setDebugMode(1, true);
  expect(decidePause({ operationName: 'GetCart', isHashOnly: false }, { tabId: 1, passive: false })).toBe('breakpoint');
});
test('disabled breakpoint and other names do not pause', async () => {
  await setBreakpoints([{ name: 'GetCart', enabled: false }, { name: 'X', enabled: true }]);
  await setDebugMode(1, true);
  expect(decidePause({ operationName: 'GetCart', isHashOnly: false }, { tabId: 1, passive: false })).toBeNull();
});
test('hash-only never pauses in active mode, even with pause-next', async () => {
  await setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await setDebugMode(1, true);
  await setPauseNext(1, true);
  expect(decidePause({ operationName: 'GetCart', isHashOnly: true }, { tabId: 1, passive: false })).toBeNull();
});
test('hash-only pauses in passive mode', async () => {
  await setBreakpoints([{ name: 'GetCart', enabled: true }]);
  await setDebugMode(1, true);
  expect(decidePause({ operationName: 'GetCart', isHashOnly: true }, { tabId: 1, passive: true })).toBe('breakpoint');
});
test('pause-next catches anonymous requests regardless of debug mode, and is one-shot', async () => {
  await setPauseNext(1, true);
  expect(decidePause({ operationName: '', isHashOnly: false }, { tabId: 1, passive: false })).toBe('pause-next');
  await consumePauseNext(1);
  expect(decidePause({ operationName: '', isHashOnly: false }, { tabId: 1, passive: false })).toBeNull();
});
test('anonymous never matches a breakpoint', async () => {
  await setBreakpoints([{ name: '', enabled: true }]);
  await setDebugMode(1, true);
  expect(decidePause({ operationName: '', isHashOnly: false }, { tabId: 1, passive: false })).toBeNull();
});
test('setBreakpoints trims, dedupes and drops empties', async () => {
  expect(await setBreakpoints([{ name: ' A ', enabled: true }, { name: 'A', enabled: false }, { name: '', enabled: true }]))
    .toEqual([{ name: 'A', enabled: true }]);
});
test('state is per tab', async () => {
  await setDebugMode(1, true);
  expect(getDebugState(2)).toEqual({ debugMode: false, pauseNext: false });
});
test('initBreakpoints restores list from local and debug state from session', async () => {
  chrome.storage.local.get.mockImplementation((k, cb) => cb({ gqlBreakpoints: [{ name: 'A', enabled: true }] }));
  chrome.storage.session.get.mockImplementation((k, cb) => cb({ gqlDebugState: { 1: { debugMode: true, pauseNext: false } } }));
  await initBreakpoints();
  expect(getBreakpoints()).toEqual([{ name: 'A', enabled: true }]);
  expect(getDebugState(1).debugMode).toBe(true);
});
```

Matching is exact and case-sensitive (GraphQL names are case-sensitive).

- [ ] **Step 2: Run to verify they fail** — `npx jest tests/unit/breakpoints.test.js` → FAIL.
- [ ] **Step 3: Implement** `js/sw/breakpoints.js` per the Interfaces block, using `storageGet`/`storageSet` from `chrome-api.js` for local; add `sessionGet(keys)`/`sessionSet(items)` to `chrome-api.js` (same pattern, `chrome.storage.session`) and use them. Rule: pause-next applies when `pauseNext && !(isHashOnly && !passive)`; breakpoint applies when `debugMode && operationName && enabled match && !(isHashOnly && !passive)`; pause-next wins over breakpoint for the reason.
- [ ] **Step 4: Run to verify they pass** — same command → PASS; `npx jest` → all PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: breakpoint store and pause decision"` (add new files first).

### Task 3: Pause queue

**Files:**
- Create: `js/sw/pause-queue.js`
- Test: `tests/unit/pause-queue.test.js`

**Interfaces:**
- Consumes: `PAUSED_QUEUE_STORAGE_KEY`, `MAX_PAUSED_PER_TAB`; `sessionGet`/`sessionSet`, `sendDebuggerCommand` from `chrome-api.js`.
- Type `HeldOperation = { index: number, operationName: string, query: string, querySource: 'request'|'registry'|'none', variables: object|null, hash: string, isHashOnly: boolean }`.
- Type `HeldRequest = { id: string /* Fetch requestId */, networkId: string, tabId: number, url: string, method: string, heldAt: number, reason: 'breakpoint'|'pause-next', state: 'paused'|'cancelled', body: object|object[] /* body as it would be sent unedited (after contamination) */, rawHeaders: Record<string,string>, operations: HeldOperation[] }`.
- Produces:
  - `ensurePausedLoaded(): Promise<void>` (idempotent)
  - `holdRequest(req: HeldRequest): Promise<boolean>` — false (caller must continue unmodified) when the tab already has `MAX_PAUSED_PER_TAB` items.
  - `listPaused(tabId: number): HeldRequest[]` (oldest first)
  - `getHeld(tabId: number, id: string): HeldRequest|null`
  - `removeHeld(tabId: number, id: string): Promise<void>`
  - `markCancelled(tabId: number, networkId: string): Promise<boolean>`
  - `continueHeld(tabId: number, id: string, params?: { postData?: string, headers?: {name,value}[] }): Promise<'sent'|'cancelled'>` — sends `Fetch.continueRequest`; a CDP error (request already gone) marks it cancelled and returns `'cancelled'`; on `'sent'` removes it.
  - `failHeld(tabId: number, id: string): Promise<'failed'|'cancelled'>` — `Fetch.failRequest` with `errorReason: 'Aborted'`.
  - `releaseAll(tabId: number): Promise<void>` — continues every `paused` item unmodified (errors ignored), clears the tab.
  - `dropTab(tabId: number): Promise<void>` — clears without sending (debugger already gone).
  - `onQueueChanged(listener: (tabId: number) => void): void` — called after every mutation.

- [ ] **Step 1: Write the failing tests** — cases:
  - `holdRequest` then `listPaused(1)` returns it; persisted via `chrome.storage.session.set` with key `gqlPausedQueue`.
  - 51st hold on one tab returns `false`.
  - `continueHeld` calls `chrome.debugger.sendCommand({tabId:1}, 'Fetch.continueRequest', {requestId:'r1', postData:'…'})`, returns `'sent'`, item gone.
  - `continueHeld` when `sendCommand` sets `chrome.runtime.lastError = {message: 'Invalid InterceptionId.'}` → returns `'cancelled'`, item state `cancelled`, still listed.
  - `markCancelled(1, 'n1')` flips state; `continueHeld` on a cancelled item returns `'cancelled'` without calling CDP.
  - `releaseAll(1)` sends `Fetch.continueRequest` with only `{requestId}` for each paused item and empties the tab; cancelled items are dropped without a CDP call.
  - `ensurePausedLoaded` restores from a session mock `{ gqlPausedQueue: { 1: [held] } }`.
  - `onQueueChanged` listener receives `1` after hold/continue/release.
- [ ] **Step 2: Run to verify they fail** — `npx jest tests/unit/pause-queue.test.js` → FAIL.
- [ ] **Step 3: Implement** `js/sw/pause-queue.js` per Interfaces (in-memory `Map<tabId, HeldRequest[]>`, persist whole map after each mutation).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git add js/sw/pause-queue.js tests/unit/pause-queue.test.js && git commit -m "feat: queue for held requests"`

### Task 4: Building the resumed request

**Files:**
- Create: `js/sw/resume-body.js`
- Test: `tests/unit/resume-body.test.js`

**Interfaces:**
- Consumes: `HeldRequest`, `digestMessage`.
- Type `ResumeEdits = { operations?: { index: number, query?: string, variables?: object|null }[], headers?: Record<string,string> }` (already-parsed JSON; the panel validates).
- Produces: `buildContinueParams(held: HeldRequest, edits?: ResumeEdits): Promise<{ postData?: string, headers?: {name: string, value: string}[] }>` — `{}` when nothing differs from `held.body`/`held.rawHeaders`.
  - Also export the existing base64 helper from `interceptor.js` as `encodeBase64Json(value: unknown): string` (moved into `resume-body.js`; interceptor imports it).

- [ ] **Step 1: Write the failing tests:**

```js
const held = (body, extra = {}) => ({ id: 'r1', tabId: 1, body, rawHeaders: { 'content-type': 'application/json', authorization: 'Bearer t' },
  operations: [], ...extra });

test('no edits → empty params', async () => {
  expect(await buildContinueParams(held({ query: 'query A { a }', variables: {} }))).toEqual({});
});
test('variables edit replaces variables only', async () => {
  const p = await buildContinueParams(held({ operationName: 'A', query: 'query A { a }', variables: { x: 1 } }),
    { operations: [{ index: 0, variables: { x: 2 } }] });
  expect(JSON.parse(atob(p.postData))).toEqual({ operationName: 'A', query: 'query A { a }', variables: { x: 2 } });
  expect(p.headers).toBeUndefined();
});
test('edited query on an APQ retry recomputes the hash', async () => {
  const body = { query: 'query A { a }', extensions: { persistedQuery: { version: 1, sha256Hash: 'old' } } };
  const p = await buildContinueParams(held(body), { operations: [{ index: 0, query: 'query A { a b }' }] });
  const sent = JSON.parse(atob(p.postData));
  expect(sent.query).toBe('query A { a b }');
  expect(sent.extensions.persistedQuery.sha256Hash).toBe(await digestMessage('query A { a b }'));
});
const hashOnly = { operationName: 'A', variables: { x: 1 }, extensions: { persistedQuery: { version: 1, sha256Hash: 'h' } } };
const fromRegistry = { operations: [{ index: 0, operationName: 'A', query: 'query A { a }', querySource: 'registry', variables: { x: 1 }, hash: 'h', isHashOnly: true }] };

test('passive hash-only: unedited registry query stays hash-only with variable edits', async () => {
  const p = await buildContinueParams(held(hashOnly, fromRegistry),
    { operations: [{ index: 0, query: 'query A { a }', variables: { x: 2 } }] });
  const sent = JSON.parse(atob(p.postData));
  expect(sent.query).toBeUndefined();
  expect(sent.extensions.persistedQuery.sha256Hash).toBe('h');
  expect(sent.variables).toEqual({ x: 2 });
});
test('passive hash-only: edited query becomes a full query with recomputed hash', async () => {
  const p = await buildContinueParams(held(hashOnly, fromRegistry), { operations: [{ index: 0, query: 'query A { a b }' }] });
  const sent = JSON.parse(atob(p.postData));
  expect(sent.query).toBe('query A { a b }');
  expect(sent.extensions.persistedQuery.sha256Hash).toBe(await digestMessage('query A { a b }'));
});
test('batched body: only the edited index changes', async () => {
  const body = [{ query: 'query A { a }', variables: {} }, { query: 'query B { b }', variables: { y: 1 } }];
  const p = await buildContinueParams(held(body), { operations: [{ index: 1, variables: { y: 2 } }] });
  const sent = JSON.parse(atob(p.postData));
  expect(sent[0]).toEqual(body[0]);
  expect(sent[1].variables).toEqual({ y: 2 });
});
test('header edits produce the full header list for continueRequest', async () => {
  const p = await buildContinueParams(held({ query: 'q' }), { headers: { 'content-type': 'application/json', authorization: 'Bearer NEW' } });
  expect(p.headers).toEqual([{ name: 'authorization', value: 'Bearer NEW' }, { name: 'content-type', value: 'application/json' }]);
  expect(p.postData).toBeUndefined();
});
```

"Edited" means the edit value differs from `held.operations[index]` (query string compare; variables deep-compare via `JSON.stringify`). If `held.operations[index]` is missing, the value is compared against the body's own operation instead. Headers are sorted by name. For the passive test, `held.operations[0].query` is the registry text — set it in the fixture.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `buildContinueParams` and move the base64 helper (`uint8ArrayToBase64` + `TextEncoder`) into `encodeBase64Json`.
- [ ] **Step 4: Run** `npx jest tests/unit/resume-body.test.js tests/unit/service-worker.test.js` → PASS (interceptor still works with the moved helper).
- [ ] **Step 5: Commit** — `git commit -m "feat: build resumed request from edits"`

### Task 5: Panel presence, interceptor hook, messaging and lifecycle

**Files:**
- Create: `js/sw/panel-presence.js`
- Modify: `js/sw/interceptor.js` (`handleFetchRequestPaused`, `contaminatePayload`)
- Modify: `js/sw/messaging.js` (`validateMessage`, `handleMessage`, broadcast ignore-list)
- Modify: `js/sw/index.js` (init calls, `onConnect`, `Network.loadingFailed`, `tabs.onUpdated` loading, `onDetach`)
- Modify: `js/sw/debugger-manager.js` (`detachDebuggerFromTab`: `releaseAll` before detach)
- Test: `tests/unit/service-worker.test.js` (new `describe` blocks), `tests/unit/panel-presence.test.js`

**Interfaces:**
- Port name: `PANEL_PORT_PREFIX = 'gql-panel:'` (constants) + tabId, e.g. `gql-panel:123`.
- Produces (`panel-presence.js`): `initPanelPresence(onLastDisconnect: (tabId: number) => void): void` (registers `chrome.runtime.onConnect`), `isPanelConnected(tabId: number): boolean`.
- Panel → SW messages (all carry `tabId: number` except `setBreakpoints`):
  - `{ getBreakpointState: true, tabId }` → `{ status: 'SUCCESS', breakpoints, debugMode, pauseNext, paused: HeldRequest[] }`
  - `{ setBreakpoints: Breakpoint[] }` → `{ status: 'SUCCESS', breakpoints }`
  - `{ setDebugMode: boolean, tabId }`, `{ setPauseNext: boolean, tabId }` → `{ status: 'SUCCESS', debugMode, pauseNext }`
  - `{ resumePaused: string, tabId, edits?: ResumeEdits }` → `{ status: 'SUCCESS', result: 'sent'|'cancelled' }`
  - `{ failPaused: string, tabId }` → `{ status: 'SUCCESS', result: 'failed'|'cancelled' }`
  - `{ resumeAllPaused: true, tabId }` → `{ status: 'SUCCESS' }` (resumes unedited items unmodified; the panel sends per-item `resumePaused` first for items it has edits for)
- SW → panel broadcast: `{ status: 'PAUSED_UPDATED', tabId, paused: HeldRequest[], pauseNext: boolean }` after every queue change (add to `handleMessage`'s ignore list).
- `HeldRequest` goes to the panel whole, including all `rawHeaders` (the user is debugging their own traffic, and the Headers editor needs them).

- [ ] **Step 1: Write failing tests** in `service-worker.test.js` → `describe('breakpoints in handleFetchRequestPaused')`:
  - Debug off, no pause-next: existing behaviour — `Fetch.continueRequest` called exactly as in the existing tests (reuse one existing fixture and assert identical call args).
  - Debug on + breakpoint `GetCart` + panel connected (`isPanelConnected` true): full-query `GetCart` request → no `Fetch.continueRequest`; `holdRequest` called with `reason: 'breakpoint'`, `operations[0].querySource: 'request'`; `INTERCEPTED` still broadcast; hash still registered.
  - Same but panel not connected → continued as today.
  - Active mode hash-only `GetCart` → contaminated and continued (never held).
  - Passive mode hash-only `GetCart`, registry has entry → held with `querySource: 'registry'` and the registry query; hash unknown → held with `querySource: 'none'`, `query: ''`.
  - Pause-next armed → held with `reason: 'pause-next'`, then `consumePauseNext` called; next request not held.
  - Batched `[GetUser, GetCart]` with breakpoint `GetCart` → one held item with two operations; `body` equals the contaminated array.
  - `holdRequest` returns false (queue full) → continued unmodified.
  - `validateMessage`: each new message rejects wrong types (e.g. `setDebugMode: 'yes'`, `resumePaused: 5`, `setBreakpoints: 'x'`, `setBreakpoints: [{name: 1}]`).
  - `resumePaused` routes to `buildContinueParams` + `continueHeld`; `failPaused` → `failHeld`; `resumeAllPaused` → `continueHeld` for each paused item.
  - `detachDebuggerFromTab` calls `releaseAll(tabId)` before detaching; `onDetach` handler calls `dropTab`; `tabs.onUpdated` with `status: 'loading'` calls `dropTab` for that tab and clears pause-next.
  - Presence: last port for tab 123 disconnects → `releaseAll(123)` and `setPauseNext(123, false)`.
  - `Network.loadingFailed` event with `{ requestId: 'n1', canceled: true }` → `markCancelled(tabId, 'n1')`.
- [ ] **Step 2: Run to verify they fail** — `npx jest tests/unit/service-worker.test.js tests/unit/panel-presence.test.js`.
- [ ] **Step 3: Implement.**
  - In `handleFetchRequestPaused`, keep the current flow up to computing `modified`. Then: if `!isPanelConnected(tabId)` or (no debug mode and no pause-next for the tab) → existing continue path, untouched. Otherwise, for each operation compute `{operationName: extractOperationName(op, lookupHash(hash)), isHashOnly}`, call `decidePause`; the request is held if any operation returns a reason (`'pause-next'` wins). Build `HeldRequest` (`id = params.requestId`, `networkId = params.networkId`, `rawHeaders = params.request.headers`, `body` = the possibly-contaminated `reqBody`). If `holdRequest` returns true, do not continue; if reason is `'pause-next'`, `consumePauseNext`. Otherwise continue as today (with the modified body if `modified`).
  - Held request whose body was contaminated: keep `body` contaminated (that is what would be sent) — editing applies on top.
  - Enable `Network` events only while needed: when `setDebugMode(tab, true)` or `setPauseNext(tab, true)` arrives and the tab is attached, send `Network.enable` with `{ maxTotalBufferSize: 0, maxResourceBufferSize: 0 }` (no body buffering); `Network.disable` when both are off. In `index.js` route `Network.loadingFailed` (`params.canceled === true`) to `markCancelled(source.tabId, params.requestId)`.
  - `index.js`: call `initBreakpoints()`, `ensurePausedLoaded()`, `initPanelPresence(...)` at SW start; `onQueueChanged` → broadcast `PAUSED_UPDATED`.
- [ ] **Step 4: Run** `npx jest` → all PASS (existing suites unchanged).
- [ ] **Step 5: Commit** — `git commit -m "feat: hold requests on breakpoints in the service worker"`

### Task 6: Main tabs for three views

**Files:**
- Create: `js/ui/tabs.js`
- Modify: `js/ui/schema-viewer.js` (remove `showMainTab`/`showDetailTab` bodies; re-export from `tabs.js`; tab click wiring moves to `initTabs`)
- Modify: `js/ui/keyboard.js:134-148` (`handleTabKeydown` maps tab id → view name generically), `focusActiveFilter` (breakpoints view has no filter → no-op)
- Modify: `js/ui/index.js` (call `initTabs()`)
- Modify: `frontend/devtools.html` (third tab button `id="tab-breakpoints"`, `aria-controls="breakpoints-content"`, `tabindex="-1"`, label `Breakpoints`; empty `<section class="view hidden" id="breakpoints-content" role="tabpanel" aria-labelledby="tab-breakpoints">`)
- Test: `tests/unit/tabs.test.js` (jsdom)

**Interfaces:**
- Produces: `showMainTab(view: 'requests'|'schema'|'breakpoints'): void`, `getActiveView(): 'requests'|'schema'|'breakpoints'`, `initTabs(): void`, `onTabShown(listener: (view) => void): void`.

- [ ] **Step 1: Failing tests** — fixture is the tab strip + three sections from `devtools.html`. Assert: `showMainTab('breakpoints')` sets `aria-selected="true"`/`tabindex="0"` on `#tab-breakpoints` only and un-hides only `#breakpoints-content`; ArrowRight from Schema focuses Breakpoints; End focuses Breakpoints; Home focuses Requests; `getActiveView()` reflects clicks. Existing `devtools.test.js` keeps passing.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**; generic mapping `id.replace('tab-', '')`.
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: three-tab main navigation"`

### Task 7: Breakpoints tab — lists, toolbar, infobar, status

**Files:**
- Create: `js/ui/panel-port.js`, `js/ui/breakpoints-view.js`
- Modify: `frontend/devtools.html` (`#breakpoints-content` markup), `frontend/css/components.css` (new section `/* ── Breakpoints ── */`), `js/ui/status.js` (pause state), `js/ui/index.js` (init + route `PAUSED_UPDATED`), `js/ui/state.js` (new fields)
- Test: `tests/unit/breakpoints-view.test.js` (jsdom)

**Interfaces:**
- Consumes: `showMainTab`, `getActiveView` (Task 6); messages from Task 5.
- `state` gains `breakpoints: Breakpoint[]`, `debugMode: boolean`, `pauseNext: boolean`, `paused: HeldRequest[]`, `selectedPausedId: string|null`.
- Produces: `connectPanelPort(tabId: number): void` (opens `chrome.runtime.connect({ name: 'gql-panel:' + tabId })`, reconnects 500 ms after `onDisconnect`); `initBreakpointsView(): void`; `renderPaused(paused: HeldRequest[], pauseNext: boolean): void`; `updateDebuggerStatus` accepts type `'paused'`.
- Markup (ids the editor in Task 8 relies on): toolbar `#bp-toolbar` with checkbox `#bp-debug-mode` (label `Debug mode`), button `#bp-pause-next` (`aria-pressed`, label `Pause on next request`), `#bp-resume-all` (label `Resume all`, title `Resume all (F8)`); infobar `#bp-infobar` (yellow, pause icon shape, text `#bp-infobar-text`); left column `#bp-paused-list` (`role="listbox"`, `aria-label="Paused requests"`) above a breakpoints form `#bp-list` with add button `#bp-add` (label `Add breakpoint`, placeholder `Operation name, e.g. GetCart`) built exactly like the patterns pane (`patterns.js` field + remove button + per-row enable checkbox with `aria-label="Enable breakpoint <name>"` drawn as filled/hollow dot); right column `#bp-editor` (Task 8 fills it); empty state `#bp-empty`.

Copy (sentence case, exact):
- Infobar: one paused → `Paused on {operationName || 'anonymous operation'}`; more → `Paused · {n} requests waiting`.
- Empty state title: `No paused requests`; body: `Add an operation name below and turn on debug mode. Matching requests pause here before they are sent.` When interception is off add: `Start interception on the Requests tab first.`
- Pause-next armed hint next to the button: `Waiting for the next intercepted request…`
- Paused list row: monospace operation name, then a word chip: `Paused` or `Cancelled by page`; cancelled rows also use a struck/hollow shape, not colour alone.
- Narrow widths: below 640px wide the editor overlays the lists, the same way the detail pane does (`layout.js`); compact density applies as elsewhere.
- Tab-strip status while anything is paused: word `Paused`, pause-bars shape, warning colour; restored to the previous word (`Intercepting`/`Passive`) when the queue empties.

- [ ] **Step 1: Failing tests** (jsdom; fixture = `#breakpoints-content` markup + tab strip; `chrome.runtime.sendMessage` mock replies):
  - On init sends `getBreakpointState` with `tabId: 123` and renders the returned breakpoints and paused items.
  - Typing a name and blur sends `setBreakpoints` with trimmed list; toggling the enable checkbox sends it with `enabled: false`.
  - Toggling `#bp-debug-mode` sends `setDebugMode: true, tabId: 123`.
  - Clicking `#bp-pause-next` sends `setPauseNext: true`, sets `aria-pressed="true"` and shows the hint.
  - `PAUSED_UPDATED` with one item while Requests tab is active → `getActiveView()` becomes `'breakpoints'`, infobar text `Paused on GetCart`, status text `Paused`, first item selected.
  - Two items → `Paused · 2 requests waiting`. Empty → infobar hidden, status restored to `Intercepting`.
  - A `cancelled` item renders `Cancelled by page`.
  - F8 with paused items sends `resumeAllPaused`; F8 with none does nothing.
  - `PAUSED_UPDATED` for another `tabId` is ignored.
  - `connectPanelPort` reconnects after `onDisconnect` (fake timers).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** markup, CSS (reuse tokens; infobar uses the existing yellow infobar style; pause shape = two 3px bars via CSS), view module, F8 in `keyboard.js` global handler, port connection in `index.js` DOMContentLoaded.
- [ ] **Step 4: Run** `npx jest` → PASS; `npm run build` → OK.
- [ ] **Step 5: Commit** — `git commit -m "feat: breakpoints tab with paused queue and breakpoint list"`

### Task 8: Paused request editor and actions

**Files:**
- Create: `js/ui/paused-editor.js`
- Modify: `frontend/devtools.html` (`#bp-editor` markup), `frontend/css/components.css`, `js/ui/breakpoints-view.js` (render editor on selection)
- Test: `tests/unit/paused-editor.test.js` (jsdom)

**Interfaces:**
- Consumes: `HeldRequest`, `ResumeEdits`, messages from Task 5, `state.selectedPausedId`.
- Produces: `renderPausedEditor(held: HeldRequest|null): void`, `getPendingEdits(id: string): ResumeEdits|null` (used by Resume all), `hasEdits(id: string): boolean`.
- Markup: sub-tabs `Query` / `Variables` / `Headers` (`role="tablist"`, same pattern as the detail pane); a `<select id="bp-operation">` shown only when `operations.length > 1`, options = operation names; `<textarea class="code-input" id="bp-query">`, `#bp-variables`, `#bp-headers` (monospace, `spellcheck="false"`); inline error `#bp-error` (`role="alert"`); buttons `#bp-resume` (`Resume this`, primary), `#bp-revert` (`Revert edits`), `#bp-fail` (`Fail request`).

Behaviour:
- Variables textarea shows `JSON.stringify(variables ?? {}, null, 2)`; Headers shows `rawHeaders` as a JSON object, 2-space indent.
- `querySource: 'none'` → Query textarea read-only with note `Not in registry — the query text is unknown. You can still edit variables and headers.`; `'registry'` → note `Filled from the hash registry. Edit it to send the full query instead of the hash.`
- A sub-tab whose content differs from the original shows the word `edited` after its label (and a dot shape).
- Edits are kept per held id in memory while the panel is open (switching between paused items keeps them).
- Resume this: parse Variables/Headers; on `JSON.parse` failure show `Variables aren't valid JSON: {message}` / `Headers aren't valid JSON: {message}`, focus the field, send nothing. Headers must be an object of string values (`Headers must be a JSON object of strings.`). Otherwise send `resumePaused` with only the changed parts in `edits`.
- Resume all: for each paused item with edits (valid), send `resumePaused` with edits; then `resumeAllPaused`. If any has invalid JSON, select it, show the error, send nothing.
- Fail request → `failPaused`. Revert edits → restore originals, clear markers.
- Response `result: 'cancelled'` → toast `The page cancelled this request before it was resumed.` (warning).
- Cancelled items: editor read-only, only `Remove` shown in place of the three buttons (sends `failPaused`, which removes it).

- [ ] **Step 1: Failing tests:** each behaviour bullet above as a test (render a `HeldRequest` fixture with two operations for the select test; assert exact messages sent, exact error copy, `edited` marker appears/disappears, read-only states).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest` → PASS; `npm run lint` → clean; `npx prettier --check --end-of-line auto "js/**/*.js" "tests/**/*.js"` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat: edit and resume paused requests"`

### Task 9: End-to-end flow, budgets, docs, demo

**Files:**
- Create: `tests/e2e/fixtures/graphql-app.html`, `tests/e2e/breakpoints.spec.js`
- Modify: `scripts/check-bundle-size.js` (budgets, measured + ≤10%)
- Modify: `store/store-description.md` (remove the `breakpoints: enable…` marker), `README.md` (Breakpoints section), `CLAUDE.md` (Architecture: new modules, panel structure gains Breakpoints tab, status vocabulary adds Paused), `PRODUCT.md` (capabilities), `CHANGELOG.md`
- Modify: `store/promo/video/demo-script.md` (add a breakpoint scene) — coordinate with the owner's uncommitted edits: read the current file first and add to it, don't replace it

- [ ] **Step 1: Write the e2e** `breakpoints.spec.js`: start a Node `http` server on `127.0.0.1` (random port) serving `graphql-app.html` (a button that `fetch`es `POST /graphql` with `{operationName:'GetCart', query:'query GetCart($c:String){cart(currency:$c)}', variables:{c:'USD'}}` and writes the response into `#out`) and a `/graphql` handler that echoes `variables.c`. Open the app page; get its tab id via the service worker (`chrome.tabs.query({url: …})`); open `devtools.html` with `inspectedWindow.tabId` set to that id (same `addInitScript` pattern as `extension.spec.js`); add pattern `*graphql*`, start; on Breakpoints tab add `GetCart`, enable debug mode; click the app button; assert the panel shows `Paused on GetCart` and `#out` is still empty after 1 s; change Variables to `{"c":"EUR"}`; Resume this; assert `#out` contains `EUR`. Second test: pause-next with an anonymous query; Fail request → `#out` shows the fetch error. Third test: close the panel page while paused → `#out` receives `USD` (released unmodified).
- [ ] **Step 2: Run** `npm run build && npx playwright test tests/e2e/breakpoints.spec.js` → PASS. If `chrome.debugger.attach` is refused under Playwright, stop and report — do not mark the task done.
- [ ] **Step 3: Run the full suite** — `npx jest && npm run test:e2e && npm run lint && npm run check:bundle` → all PASS (raise budgets only as allowed).
- [ ] **Step 4: Update docs** as listed; re-record the demo with `npm run promo:video` after the owner confirms the updated `demo-script.md`.
- [ ] **Step 5: Commit** — `git commit -m "test: breakpoints end-to-end; docs and budgets"`
