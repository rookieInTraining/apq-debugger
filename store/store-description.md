# APQ Debugger — Chrome Web Store Listing

## Short Description (132 characters max)

Reveal full GraphQL queries behind Apollo APQ hashes. Debug Automatic Persisted Queries in Chrome DevTools.

## Detailed Description

APQ Debugger is a Chrome DevTools extension for developers working with Apollo Client's Automatic Persisted Queries (APQ).

When Apollo Client uses APQ, network requests only contain a SHA-256 hash instead of the full GraphQL query. This makes debugging difficult — you can't see what query is actually being executed just by looking at the Network tab.

APQ Debugger solves this by intercepting APQ requests and triggering the fallback mechanism, forcing Apollo Client to send the full query. You get to see the complete GraphQL operation, variables, and more — right inside DevTools.

### How It Works

1. Open Chrome DevTools and go to the "APQ Debugger" panel
2. Add URL patterns to match your GraphQL endpoint (e.g., *graphql*)
3. Click "Start Debugging"
4. Browse your app — intercepted requests appear in real time

### Features

- Real-time network interception of GraphQL requests
- Configurable URL pattern matching for targeted debugging
- Live request list with type filtering (APQ vs. full query)
- Syntax-highlighted GraphQL query viewer
- One-click copy for queries and variables
- Request history with search and filtering
- Light and dark theme support (follows system preference)
- Toolbar toggle for quick start/stop without opening DevTools
- Persistent URL patterns across browser sessions

### Who Is This For?

- Frontend developers using Apollo Client with APQ
- Backend developers debugging GraphQL API interactions
- QA engineers investigating GraphQL request behavior
- Anyone who needs to see the full query behind an APQ hash

### Privacy

APQ Debugger processes all data locally in your browser. No data is collected, transmitted, or stored externally. See our full privacy policy for details.

---

## Category

Developer Tools

## Language

English

## Screenshots

The following screenshots should be prepared and included in the store listing:

1. **Main panel (dark mode)** — DevTools panel showing the request list with several intercepted requests, the URL pattern configuration, and the "Active" status badge.

2. **Request detail (dark mode)** — Detail panel open showing a full GraphQL query with syntax highlighting, operation name, variables, and the copy button.

3. **Main panel (light mode)** — Same as screenshot 1 but with the light theme to show both theme variants.

4. **Toolbar toggle** — The browser toolbar showing the APQ Debugger icon with the "ON" badge and the right-click context menu with "Toggle APQ Debugger".

## Promotional Images

- **Small tile (440x280):** APQ Debugger logo with tagline "Debug Apollo Persisted Queries in DevTools"
- **Large tile (920x680):** Logo + screenshot of the DevTools panel in action, with feature highlights overlaid
