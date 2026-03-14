# APQ Debugger — Privacy Policy

**Last updated:** February 7, 2026

## Overview

APQ Debugger is a Chrome DevTools extension that helps developers debug Apollo Client Automatic Persisted Queries (APQ). This privacy policy explains what data the extension accesses and how it is handled.

## Data Collection

**APQ Debugger does not collect, transmit, or store any personal data.** All data processing happens entirely within the user's browser.

## What the Extension Accesses

When the user explicitly enables debugging on a specific tab, the extension:

1. **Intercepts network requests** matching user-configured URL patterns on that tab only. The extension reads and modifies GraphQL request payloads to trigger the APQ fallback mechanism.

2. **Displays request data** in the DevTools panel, including operation names, GraphQL queries, and variables. This data is held in memory and is discarded when the DevTools panel is closed.

3. **Stores user preferences** (URL patterns and active-tab state) in `chrome.storage.local` to persist settings across browser sessions. This data never leaves the browser.

## What the Extension Does NOT Do

- Does **not** collect analytics or telemetry
- Does **not** transmit any data to external servers
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

## Third-Party Services

APQ Debugger does not use any third-party services, libraries that phone home, or external APIs.

## Changes to This Policy

If this privacy policy is updated, the changes will be noted in the extension's CHANGELOG and the "Last updated" date above will be revised.

## Contact

For questions about this privacy policy or the extension's data handling, please open an issue on the [GitHub repository](https://github.com/rookieInTraining/apq-debugger).
