# Changelog

All notable changes to the APQ Debugger extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
| 1.1.0 | `5b035ba` | 2026-01-30 |
| 1.0.0 | `96f5ff3` | 2026-01-26 |
| 0.1.0 | `79d6472` | 2024-07-05 |
