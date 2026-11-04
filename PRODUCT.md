# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and testers working on web apps that use GraphQL (APQ users first). They are mid-investigation inside Chrome DevTools, usually with the Network panel open beside this one, often docked at the bottom of the window at a few hundred pixels tall. Their job: see the real operation, variables and endpoint behind an opaque SHA-256 hash, then copy it into an editor, a cURL or a bug report.

## Product Purpose

GraphQL Debugger works at the network level, so it works with any GraphQL client (Apollo Client, Relay, urql and more) on any site, and it can change traffic as well as read it. Its first feature recovers the query behind Apollo APQ hashes: APQ requests carry only a hash, so the Network panel cannot show what query ran. It attaches the Chrome Debugger to the inspected tab, swaps the hash for a bogus one so the server answers `PersistedQueryNotFound`, and captures the full query Apollo Client retries with. Success: within seconds of browsing, every GraphQL operation on the page is readable, copyable, and attributable to its endpoint.

## Positioning

It works from live traffic without access to the app's source, build, or server-side persisted-query store, and it is not tied to one client library. Passive mode resolves known APQ hashes from a local registry without touching traffic at all.

## Operating Context

- Lives as a DevTools panel; identifies its tab via `chrome.devtools.inspectedWindow.tabId`; works undocked and docked.
- Starting interception shows Chrome's own "is debugging this browser" infobar and rewrites matching requests on a real (often production) site.
- Session flow: set URL patterns → start → browse → read/copy operations → optionally load the schema by introspection → stop.
- A toolbar action can also start/stop without opening the panel.

## Capabilities and Constraints

- Active mode (hash contamination) vs passive mode (registry lookup, no traffic changes); registry is LRU-capped.
- Request list with operation-name filter, APQ/full filter, endpoint filter; detail with query, variables, copy, Copy as cURL (Bash/PowerShell); JSON export; history clear.
- Breakpoints tab: pause matching requests by operation name (debug mode) or the next request; edit query, variables and headers, then resume (one, or all with F8) or fail. Only the request is held, never page JavaScript; requests are held only while the panel is open and are released unmodified when it closes, the page navigates, the tab closes or interception stops.
- Schema tab: introspect observed endpoints (replaying captured headers) or a typed URL; SDL type browser.
- Theme (system/light/dark) and density (comfortable/compact) settings.
- MV3, `minimum_chrome_version` 123. No network-loaded fonts, icons or scripts; everything ships in the bundle.
- Terminology: "APQ" (hash-only request), "full" (request carrying query text), "resolved" (hash mapped to query).

## Brand Commitments

- Name: GraphQL Debugger. Icons in `icons/`.
- Visual direction (confirmed 2026-10-21): DevTools-native. The panel should sit alongside Chrome DevTools' own panels (Network, Elements) as if it belonged there. This replaces the earlier Kora styling.

## Evidence on Hand

- Store copy: `store/store-description.md`; privacy policy and permission justifications in `store/`.
- No testimonials, user counts or benchmarks exist; do not invent them.

## Product Principles

1. The recovered query is the product. Everything else serves reading and copying it.
2. Be honest about interception: the user always knows whether traffic is being rewritten, on which patterns.
3. Belong in DevTools. Earned familiarity beats personality; save emphasis for state changes and the moment a hash resolves.
4. Work at the docked size people actually use.
5. Local first: nothing from your traffic leaves the browser; anonymous feature usage is sent only if you opt in.

## Accessibility & Inclusion

WCAG 2.2 AA: visible focus on every interactive element, full keyboard operation of list/detail/tabs, 4.5:1 text contrast in both themes, forced-colors and reduced-motion support (already present in the codebase).
