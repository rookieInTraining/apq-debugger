# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome MV3 DevTools extension that reveals the full GraphQL operations behind Apollo Automatic Persisted Query (APQ) hashes. It attaches the Chrome Debugger API to a tab, intercepts requests via `Fetch.requestPaused`, and replaces the APQ hash with a bogus one so the server responds `PersistedQueryNotFound`, forcing Apollo Client to retry with the full query text — which is then captured and shown in a DevTools panel.

## Commands

```bash
npm run build          # Bundle & minify into extension_build/ (the only loadable folder)
npm run build:dev      # Build with inline source maps, no minification
npm run watch          # Rebuild on change (reload extension in chrome://extensions after)
npm test               # Jest unit tests (coverage always collected)
npx jest tests/unit/hash-registry.test.js      # Single test file
npx jest -t "should evict the oldest hash"     # Single test by name
npm run test:e2e       # Playwright e2e (launches real Chrome with the built extension)
npm run lint           # ESLint
npm run format:check   # Prettier check (see Windows note below)
```

Releases: `npm version patch|minor|major` (syncs manifest.json via `scripts/sync-version.js`), then `git push --follow-tags` — the release workflow builds, tests, and publishes the zip.

- The default branch is **`trunk`**, not `main`. CI runs on pushes/PRs to trunk only.
- `package.json` is the canonical version; `manifest.json` is synced from it (also patched at build time).
- **Windows note:** the repo checks out with CRLF (`core.autocrlf=true`), so `npm run format:check` fails locally on line endings alone. Use `npx prettier --check --end-of-line auto <globs>` to see real violations; commits are normalized to LF so CI is unaffected.

## Architecture

Two independently bundled contexts that communicate only via `chrome.runtime.sendMessage`:

- **Service worker** (`js/sw/`, entry `index.js` → built as `service-worker.min.js`): owns all Chrome Debugger interaction. `debugger-manager.js` handles attach/detach lifecycle, `interceptor.js` handles `Fetch.requestPaused` and hash contamination, `messaging.js` routes incoming messages, `chrome-api.js` wraps callback APIs in promises.
- **DevTools panel** (`js/ui/`, entry `index.js` → built as `devtools.min.js` loaded by `frontend/devtools.html`): one module per UI concern, all sharing the mutable `state` object in `js/ui/state.js`. The panel identifies its tab via `chrome.devtools.inspectedWindow.tabId` (reliable even when undocked).
- **`js/shared/`**: constants and logger used by both bundles. The GraphQL introspection query is a string literal here specifically so the `graphql` npm package stays out of the service worker bundle.

Key cross-cutting behaviors:

- **MV3 service worker restarts:** all state that must survive (attached tabs, URL patterns, hash registry, passive-mode flag) lives in `chrome.storage.local`; observed endpoints live in `chrome.storage.session` (right lifetime: survives SW restarts, cleared on browser exit). `isDebuggerActive()` checks memory → storage → live `chrome.debugger.getTargets()` and self-heals. `initRegistry()` and `restoreDebuggerState()` run on every SW start. Never keep must-survive state in module-level variables alone — a user-triggered message often wakes a *fresh* SW.
- **Hash registry / passive mode** (`js/sw/hash-registry.js`): active mode contaminates hashes and records hash→query mappings from the retries; passive mode resolves hashes from the registry without touching traffic. Capped at `HASH_REGISTRY_MAX_ENTRIES` (LRU eviction; insertion order is recency — re-registering deletes then re-sets the key).
- **Messaging convention:** SW→panel messages are broadcast with a `tabId` field and filtered on the receiving side; panel→SW messages are validated in `messaging.js` (`validateMessage`) before routing. Every `sendMessage` callback checks `chrome.runtime.lastError` because the panel is frequently not open.
- **Schema loading** (`js/sw/schema-loader.js`): runs in the SW (which has `<all_urls>` host permission for cross-origin fetch). Endpoints observed by the interceptor (`endpoint-tracker.js`) are known GraphQL endpoints, so they are introspected directly, replaying the request headers captured from live traffic (production gateways reject bare requests); only the common-path guesses on the page's origin are probed with a bare `{__typename}` request.
- **Build** (`build-enhanced.js`): esbuild bundles both entries as IIFEs; production drops `debugger` statements and treats `console.info`/`console.debug` as pure (stripped) — so use those for dev-only logging and `console.log`/`warn`/`error` for messages that should survive in release builds. The HTML/manifest are patched for the flat `extension_build/` layout; loading the repo root unpacked does not work.

## Tests

- Jest's default environment is **node**; DOM tests must start with a `/** @jest-environment jsdom */` docblock (see `tests/unit/devtools.test.js`, `tests/unit/curl-copy.test.js`).
- Chrome APIs are mocked manually as `global.chrome` in `tests/unit/setup.js` (not via jest-chrome) — extend that file when a test needs an API surface that isn't mocked yet.
- Files are transformed with esbuild (`jest-esbuild-transform.js`), so ES modules in `js/` import cleanly.
- Test DOM fixtures are built inline with `document.body.innerHTML` mirroring the relevant fragment of `frontend/devtools.html`.

## Conventions

From CONTRIBUTING.md, the ones that matter in practice: promise-wrap Chrome APIs via `chrome-api.js` rather than using raw callbacks; JSDoc on all exported functions; wrap `JSON.parse` in try/catch; handle `chrome.runtime.lastError` in every Chrome API callback; one responsibility per module.
