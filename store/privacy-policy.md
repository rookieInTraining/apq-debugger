# GraphQL Debugger — Privacy Policy

**Last updated:** November 4, 2026

## Overview

GraphQL Debugger is a Chrome DevTools extension that helps developers debug GraphQL, including Apollo Client Automatic Persisted Queries (APQ). This privacy policy explains what data the extension accesses and how it is handled.

## Data Collection

**By default, GraphQL Debugger collects and transmits nothing.** All processing of your GraphQL traffic happens entirely within your browser, and that traffic is never sent anywhere.

### Optional anonymous usage analytics (opt-in)

The first time you open the panel you are asked whether to share anonymous feature usage. Nothing is sent unless you choose to allow it. Declining or dismissing the notice counts as "no", and you are not asked again. You can change your mind at any time with the analytics toggle in the panel settings.

If you allow it, the extension sends the following events to Google Analytics 4 (event name, with the only parameters it can carry):

| Event | When | Parameters |
| --- | --- | --- |
| `panel_open` | The DevTools panel is opened | none |
| `interception_start` | Interception starts | mode (active or passive), trigger (panel or toolbar) |
| `interception_stop` | Interception stops | trigger (panel, toolbar or chrome) |
| `debug_mode_set` | Debug mode is switched | on (yes or no) |
| `pause_next_armed` | "Pause next request" is armed | none |
| `breakpoint_hit` | A request is paused | reason (breakpoint or pause_next), mode (active or passive) |
| `paused_resume` | A paused request is resumed | edited (yes or no) |
| `paused_resume_all` | All paused requests are resumed | none |
| `paused_fail` | A paused request is failed | none |
| `schema_load` | A schema load finishes | result (success or error), source (observed, guessed or manual) |
| `copy` | Something is copied | what (query, variables, hash, curl_bash or curl_powershell) |
| `export_history` | The request history is exported | none |
| `settings_change` | Theme or density is changed | theme (system, light or dark), density (comfortable or compact) |
| `analytics_opt_in` | You allow analytics | none |

Every event also carries these coarse properties: the extension version, the Chrome major version, the operating system (for example `win` or `mac`) and the browser UI language.

Events are tied together by two random identifiers: an install ID (a random UUID created when you allow analytics, stored in `chrome.storage.local`) and a session ID (a random number, stored in `chrome.storage.session` and cleared when the browser exits). Neither is derived from you, your accounts or your browsing.

Events are sent over HTTPS to `www.google-analytics.com`. Google acts as a data processor for this measurement. As with any web request, Google's servers receive the connection's IP address; the extension does not include it in the event data.

**Never sent, even when analytics is on:** URLs, hostnames, operation names, queries, variables, headers, persisted-query hashes, schema contents, endpoint paths, error messages, or anything else derived from your network traffic or the pages you inspect. Only the fixed event names and fixed values listed above can be sent; anything else is discarded before it leaves the extension.

**Turning it off:** switch off the analytics toggle in the panel settings. The extension stops sending immediately and deletes both the install ID and the session ID. If you turn it on again later, a new random install ID is created. Uninstalling the extension removes all stored data.

Some builds of the extension (for example builds from source) have no analytics configured; in those builds analytics is fully off and no notice or toggle is shown.

## What the Extension Accesses

When the user explicitly enables debugging on a specific tab, the extension:

1. **Intercepts network requests** matching user-configured URL patterns on that tab only. The extension reads and modifies GraphQL request payloads to trigger the APQ fallback mechanism.

2. **Displays request data** in the DevTools panel, including operation names, GraphQL queries, and variables. This data is held in memory and is discarded when the DevTools panel is closed.

3. **Stores data locally** in `chrome.storage.local` to persist it across browser sessions: the URL patterns, the active-tab state, the operation breakpoint list, the analytics consent choice, and the analytics install ID (only while you have opted in). It also keeps the hash registry (APQ hashes and the queries captured for them) and the passive-mode flag, the schema endpoint and its cached schema, panel sizes and display settings. None of this data leaves the browser; the install ID is sent only with opted-in analytics events.

## What the Extension Does NOT Do

- Does **not** send any analytics or telemetry unless you opt in (see above), and then only the allowlisted events listed above
- Does **not** transmit your GraphQL traffic, URLs, queries, variables, headers or hashes to any server
- Does **not** access browsing history, bookmarks, or passwords
- Does **not** run on any page until the user explicitly starts debugging
- Does **not** modify any requests outside of the user-configured URL patterns
- Does **not** operate on tabs where debugging has not been explicitly enabled

## Permissions Used

The extension requests only the permissions strictly necessary for its functionality. See [permissions-justification.md](permissions-justification.md) for a detailed explanation of each permission.

## Data Retention

- **In-memory request history** is cleared when the DevTools panel is closed or the browser tab is closed.
- **Stored URL patterns** persist in `chrome.storage.local` until the user removes them or uninstalls the extension.
- **Active-tab state** is stored temporarily and cleaned up automatically when tabs are closed.
- **Analytics identifiers** (only if you opt in) exist until you turn analytics off, at which point they are deleted. Events already received by Google Analytics are retained according to that analytics property's retention settings.

## Third-Party Services

**Google Analytics 4** (Google LLC) is used only if you opt in to anonymous usage analytics, and only to receive the events described above. Google processes them on our behalf. No other third-party services, advertising or tracking libraries are used, and the extension loads no scripts from the network.

## Changes to This Policy

If this privacy policy is updated, the changes will be noted in the extension's CHANGELOG and the "Last updated" date above will be revised.

## Contact

For questions about this privacy policy or the extension's data handling, please open an issue on the [GitHub repository](https://github.com/rookieInTraining/apq-debugger).
