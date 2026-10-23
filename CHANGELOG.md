# Changelog

All notable changes to the APQ Debugger extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] - 2026-10-23

### Added
- Observed endpoints in the patterns pane: GraphQL endpoints seen in live
  traffic, with request counts and one-click "Add as pattern"
- Request and resolved-hash counts in the toolbar
- Endpoint filter and automatic endpoint group headers in the request list
- Row states with a word and a shape for each: Resolved, Awaiting retry,
  Not in registry, APQ retry, Full query; a hash row resolves in place when
  its full-query retry arrives
- Infobar while traffic is being rewritten, and in passive mode
- Toast notifications (replacing the status banner), confirm dialogs before
  clearing history or the hash registry, and skeleton loading for the schema
  explorer
- Comfortable and compact row density (compact applies automatically in short
  DevTools docks)
- New read-only `getObservedEndpoints` service-worker message

### Changed
- **Full UI redesign as a DevTools-native panel**, matching Network and
  Elements: tab strip, per-view toolbar, collapsible patterns pane (open by
  default until a pattern is saved), request table with a detail split that
  overlays the list in narrow docks
- System UI font only; no bundled or network fonts
- Light and dark colours defined once via CSS `light-dark()` (requires
  Chrome 123+, declared via `minimum_chrome_version`)
- One-word status vocabulary: Off, Starting, Intercepting, Passive, Stopping,
  Error
- Schema SDL highlighting rewritten as a single-pass lexer: fields, arguments,
  default values, directive arguments, interfaces, unions and directive
  locations are now coloured correctly, in DevTools Sources colours
- CSS build supports ordered multi-file concatenation with a size budget;
  panel bundle budget raised to 55 KB

### Fixed
- SDL comments containing a string no longer render stray placeholder
  characters in the schema viewer
- All-caps type names (such as `URL`) are no longer coloured as enum values

## [3.0.0] - 2026-06-13

### Added
- Passive mode: resolve APQ hashes from the registry without contaminating live traffic
- GraphQL schema introspection and SDL viewer in a dedicated Schema tab
- Copy as cURL for captured requests
- Keyboard navigation and shortcuts across the DevTools panel
- Responsive layout for narrower DevTools dock sizes
- Bundle size budget check in CI (`npm run check:bundle`)

### Changed
- **Major UI redesign** — tabbed layout separating requests, schema, and settings
- Schema moved from inline controls to its own tab and viewer
- Optimized production bundle sizes for the service worker and DevTools panel

### Fixed
- Schema endpoint detection when multiple GraphQL endpoints are observed
- Prettier formatting violations that failed the CI lint job

## [2.0.0] - 2026-02-07

### Added
- Modular architecture: service worker split into `sw/` modules (chrome-api, debugger-manager, interceptor, messaging, storage, hash)
- Modular architecture: DevTools panel split into `ui/` modules (state, dom-helpers, patterns, request-list, request-detail, status, debugger-controls)
- esbuild-powered build system replacing Terser for ~100x faster bundling
- Promise wrappers for all callback-based Chrome APIs (`sw/chrome-api.js`)
- Cached bogus hash to avoid recomputing SHA-256 on every APQ request
- Chunked base64 encoding to prevent stack overflow on large payloads (>65KB)
- Request history cap (500 entries) to prevent unbounded memory growth
- Incremental request list rendering (prepend new items instead of full re-render)
- Lightweight message schema validation at the `onMessage` entry point
- Global `unhandledrejection` handler in the service worker
- Unit tests for DevTools panel (pattern management, request history, utilities)
- ESLint and Prettier for consistent code style
- Release automation via GitHub Actions (build, test, package on version tags)
- Version sync between `package.json` and `manifest.json` via npm lifecycle hook
- `npm run package` script to zip extension for Chrome Web Store upload
- CONTRIBUTING.md with development setup and architecture guide
- Chrome Web Store assets (privacy policy, permissions justification, store description)
- JSDoc comments on all exported functions

### Changed
- Service worker is now bundled from ES modules instead of a single monolithic file
- DevTools panel is now bundled from ES modules instead of a single monolithic file
- Build output now goes to `extension_build/` with flat file structure
- License field in package.json corrected to Apache-2.0 (matching LICENSE file)

### Fixed
- Base64 encoding overflow (`RangeError`) for payloads larger than ~65KB
- Consistent `chrome.runtime.lastError` handling across all Chrome API callbacks

## [1.1.0] - 2026-01-30

### Fixed
- Fixed "No active tab found" error when DevTools panel is undocked (`5b035ba`)
- Fixed state synchronization between DevTools panel and extension toolbar icon
- Fixed ON/OFF badge indicator not updating when toggling from DevTools panel
- Fixed false-positive "debugger active" state when opening DevTools panel

### Changed
- DevTools panel now uses `chrome.devtools.inspectedWindow.tabId` to reliably identify the inspected tab
- DevTools panel now checks debugger state on load and syncs UI accordingly
- Badge updates now happen directly in attach/detach functions for consistent state

## [1.0.0] - 2026-01-26

### Added
- Toggle debugger on/off from extension toolbar icon (`96f5ff3`)
- Context menu option for toggling the debugger
- Persist URL patterns to `chrome.storage.local`
- Restore patterns automatically when DevTools panel reopens
- System notifications when patterns are not configured

### Fixed
- Fix for `btoa` exception when Chinese or Arabic characters are part of the payload

## [0.1.0] - 2024-07-05

### Added
- Initial release of APQ Debugger Chrome extension (`79d6472`)
- DevTools panel for debugging Apollo GraphQL Persisted Queries
- Network request interception using Chrome Debugger API
- URL pattern matching for selective request interception
- SHA-256 hash contamination to trigger APQ fallback flow
- Request counter showing number of intercepted requests
- Support for batch GraphQL requests (array payloads)

### Documentation
- Added README.md with installation and usage instructions (`7077ce9`)
- Fixed logo display in README (`14d913d`)

---

## Commit Reference

| Version | Commit | Date |
|---------|--------|------|
| 4.0.0 | — | 2026-10-23 |
| 3.0.0 | — | 2026-06-13 |
| 2.0.0 | — | 2026-02-07 |
| 1.1.0 | `5b035ba` | 2026-01-30 |
| 1.0.0 | `96f5ff3` | 2026-01-26 |
| 0.1.0 | `79d6472` | 2024-07-05 |
