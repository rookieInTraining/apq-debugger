<p align="center">
   <img src="./icons/icon128.png" style="padding: 20px;">
</p>

# APQ Debugger — Chrome extension for Apollo GraphQL Persisted Queries (APQ)

**APQ Debugger** reveals the full GraphQL operation behind Apollo Client's Automatic Persisted Queries (APQ) hashes and visualizes the fallback flow in Chrome DevTools.
[→ Install from Chrome Web Store](https://chromewebstore.google.com/detail/apq-debugger-beta/gbanmonipiommdljkadhhiomhkgjchee)

## Features

- **Network Interception**: Intercept and modify GraphQL requests in real-time
- **Pattern Matching**: Use URL patterns to target specific GraphQL endpoints
- **DevTools Integration**: Seamless integration with Chrome DevTools
- **APQ Fallback Visualization**: See both the hash-only and full-query phases of APQ requests
- **Request History**: Browse, filter, and inspect intercepted requests with syntax highlighting

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the project folder (or `extension_build/` after building)
5. Open DevTools and look for the "APQ Debugger" panel

## Usage

1. Navigate to the target page with Apollo Client
2. Open Chrome DevTools and go to the "APQ Debugger" panel
3. Add URL patterns to match GraphQL endpoints (e.g., `*graphql*`, `*/api/*`)
4. Click "Start Debugging" to begin interception
5. Intercepted requests will trigger twice:
   - First: Failing due to `PersistedQueryNotFound`
   - Second: Containing the full GraphQL query

## File Structure

```
apq-debugger/
├── frontend/
│   ├── devtools.html              # Main DevTools panel HTML
│   └── devtools.css               # Panel styles (dark/light theme)
├── js/
│   ├── sw/                        # Service worker modules
│   │   ├── index.js               # Entry point – event wiring
│   │   ├── chrome-api.js          # Promise wrappers for Chrome APIs
│   │   ├── debugger-manager.js    # Attach/detach/restore lifecycle
│   │   ├── interceptor.js         # Fetch.requestPaused handler
│   │   ├── messaging.js           # onMessage router & action toggle
│   │   ├── storage.js             # chrome.storage.local helpers
│   │   └── hash.js                # SHA-256 digest utility
│   ├── ui/                        # DevTools panel modules
│   │   ├── index.js               # Entry point – panel creation
│   │   ├── state.js               # Shared reactive state
│   │   ├── dom-helpers.js         # DOM query & escape utilities
│   │   ├── patterns.js            # URL pattern CRUD & storage sync
│   │   ├── request-list.js        # Request list rendering & filtering
│   │   ├── request-detail.js      # Detail panel & copy-to-clipboard
│   │   ├── status.js              # Status badge & banner management
│   │   └── debugger-controls.js   # Start/stop button orchestration
│   ├── devtools.js                # Legacy monolithic panel script
│   └── service-worker.js          # Legacy monolithic service worker
├── scripts/
│   ├── sync-version.js            # Sync package.json → manifest.json version
│   └── package-extension.js       # Zip extension_build/ for Web Store upload
├── tests/
│   ├── unit/                      # Jest unit tests
│   └── e2e/                       # Playwright end-to-end tests
├── icons/                         # Extension icons (16/32/48/128 px)
├── store/                         # Chrome Web Store assets
├── .github/workflows/             # CI/CD (lint, test, build, release)
├── manifest.json                  # Chrome extension manifest (MV3)
├── package.json                   # Node.js project metadata
├── build-enhanced.js              # esbuild-powered build script
└── README.md                      # This file
```

## Development

### Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the extension**:
   ```bash
   npm run build
   ```

3. **Watch mode for development**:
   ```bash
   npm run watch
   ```

4. **Load the extension**:
   - Go to `chrome://extensions/` and enable Developer mode
   - Click "Load unpacked" and select the `extension_build/` folder

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Bundle & minify JS/CSS into `extension_build/` |
| `npm run build:dev` | Development build with source maps |
| `npm run watch` | Watch mode — rebuild on file changes |
| `npm test` | Run unit tests (Jest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run lint` | Lint JS with ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |
| `npm run package` | Zip `extension_build/` for Chrome Web Store |
| `npm run release` | Build + package in one step |

### Releasing a New Version

```bash
# Bump version (auto-syncs manifest.json and creates a git tag)
npm version patch   # or minor / major

# Push the tag to trigger the release workflow
git push --follow-tags
```

The GitHub Actions [release workflow](.github/workflows/release.yml) will automatically build, test, and create a GitHub Release with the `.zip` artifact.

## Technical Details

### How It Works

1. **Pattern Matching**: Uses the Chrome Debugger API's `Fetch.requestPaused` event to intercept requests matching user-specified URL patterns
2. **Hash Contamination**: Replaces the SHA-256 hash in APQ-only requests with a bogus value, forcing Apollo Client to retry with the full query
3. **Query Capture**: Captures the full GraphQL query from the retry request and sends it to the DevTools panel
4. **Real-time Display**: The DevTools panel shows intercepted requests with filtering, syntax highlighting, and one-click copy

### Architecture

- **Service Worker** (`js/sw/`): Background process handling network interception via the Chrome Debugger API
- **DevTools Panel** (`js/ui/`): User interface for configuration and live request monitoring
- **Message Passing**: Bidirectional communication between the panel and service worker via `chrome.runtime.sendMessage`
- **Persistent State**: URL patterns and attached-tab state are persisted in `chrome.storage.local` to survive service worker restarts

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture details, and contribution guidelines.

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.
