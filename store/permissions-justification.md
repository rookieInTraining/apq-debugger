# APQ Debugger — Permissions Justification

This document explains why each permission declared in `manifest.json` is required, for Chrome Web Store review and transparency.

## Required Permissions

### `debugger`

**Why:** Core functionality. The extension uses the Chrome Debugger API (`chrome.debugger.attach`, `chrome.debugger.sendCommand`) to intercept and modify network requests at the protocol level. This is the only reliable way to intercept, read, modify, and continue HTTP requests in a Manifest V3 extension without a network proxy.

**Scope:** Only attached to tabs where the user has explicitly started debugging. Automatically detached when the user stops debugging or closes the tab.

### `tabs`

**Why:** Required to identify the active tab when the user clicks the toolbar button or starts debugging from the DevTools panel. Used via `chrome.tabs.query` and `chrome.tabs.get` to retrieve tab metadata (ID, URL) for debugger attachment.

**Scope:** Only queries the active tab in the current window; does not enumerate or monitor all tabs.

### `storage`

**Why:** Persists user-configured URL patterns and the list of tabs with active debugger sessions in `chrome.storage.local`. This allows settings to survive browser restarts and service worker lifecycle events without any external server.

**Scope:** Only reads and writes extension-specific keys (`apqPatterns`, `apqAttachedTabs`). No sensitive user data is stored.

### `contextMenus`

**Why:** Adds a "Toggle APQ Debugger" option to the extension's toolbar icon right-click menu, providing an alternative way to start/stop debugging without opening DevTools.

**Scope:** Only creates a single context menu item on the extension's own action button (`contexts: ['action']`). Does not add menus to web pages.

**Note:** This permission could potentially be removed if the toolbar-toggle feature is deemed non-essential. Removing it would reduce the install-time permission prompt slightly.

### `notifications`

**Why:** Shows a system notification when the user tries to toggle the debugger via the toolbar button but no URL patterns have been configured yet. This guides the user to open the DevTools panel and add patterns first.

**Scope:** Only used for this single notification scenario. No recurring or background notifications.

**Note:** This permission could be made optional or removed entirely by replacing the system notification with an alternative UX (e.g., opening the DevTools panel directly, or using the badge text). Removing it would reduce the install-time permission footprint.

## Host Permissions

### `<all_urls>`

**Why:** The Chrome Debugger API requires host permissions for the tabs it attaches to. Since GraphQL endpoints can be hosted on any domain, the extension needs broad host access. The user controls which URLs are actually intercepted via the URL pattern configuration.

**Scope:** Despite the broad permission, the extension only intercepts requests that match user-configured URL patterns on tabs where the user has explicitly enabled debugging.

---

## Recommendations for Minimizing Permissions

To reduce install friction (fewer permission warnings = higher install rate), the following changes could be considered:

1. **`notifications`** — Replace with badge text or a popup message. This would eliminate one permission from the install prompt.

2. **`contextMenus`** — Remove if the toolbar toggle is not a critical feature. Users can always use the DevTools panel to start/stop debugging.

3. **`<all_urls>`** — Could theoretically be replaced with `activeTab` + runtime host permission requests, but this would significantly complicate the UX since the debugger needs to stay attached across navigations. Not recommended.
