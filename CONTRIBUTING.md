# Contributing to APQ Debugger

Thank you for your interest in contributing to APQ Debugger! This document covers the development setup, architecture, coding conventions, and the process for submitting changes.

## Development Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Google Chrome** (latest stable)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/rookieInTraining/apq-debugger.git
cd apq-debugger

# Install dependencies
npm install

# Build the extension
npm run build

# Run tests
npm test
```

### Loading the Extension Locally

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension_build/` folder (created by `npm run build`)
5. Open DevTools on any page — the **APQ Debugger** panel will appear

### Watch Mode

During development, use watch mode to automatically rebuild on file changes:

```bash
npm run watch
```

After a rebuild, go to `chrome://extensions/` and click the reload button on the APQ Debugger card, then reopen DevTools.

## Architecture Overview

The extension follows Chrome Manifest V3 conventions with a **service worker** for background processing and a **DevTools panel** for the user interface.

### Service Worker (`js/sw/`)

The service worker intercepts network requests using the Chrome Debugger API.

| Module | Responsibility |
|--------|----------------|
| `index.js` | Entry point — registers Chrome event listeners |
| `chrome-api.js` | Promise wrappers for callback-based Chrome APIs |
| `debugger-manager.js` | Attach, detach, restore, and state-tracking lifecycle |
| `interceptor.js` | `Fetch.requestPaused` handler and APQ payload contamination |
| `messaging.js` | `chrome.runtime.onMessage` router and toolbar toggle |
| `storage.js` | `chrome.storage.local` helpers for patterns and tabs |
| `hash.js` | SHA-256 digest utility |

### DevTools Panel (`js/ui/`)

The DevTools panel provides the user interface for configuring patterns and viewing intercepted requests.

| Module | Responsibility |
|--------|----------------|
| `index.js` | Entry point — panel creation and message listeners |
| `state.js` | Shared mutable state (patterns, history, filters) |
| `dom-helpers.js` | DOM query, escape, and truncation utilities |
| `patterns.js` | URL pattern CRUD and `chrome.storage.local` sync |
| `request-list.js` | Request list rendering, filtering, and incremental updates |
| `request-detail.js` | Detail panel rendering, syntax highlighting, and clipboard copy |
| `status.js` | Status badge and banner management |
| `debugger-controls.js` | Start/stop button orchestration and UI state transitions |

### Data Flow

```
User clicks "Start" in DevTools panel
  → chrome.runtime.sendMessage({ patterns, tabId })
  → Service worker attaches Chrome Debugger to the tab
  → Fetch.enable with URL patterns

Browser makes a GraphQL request matching a pattern
  → Fetch.requestPaused fires in the service worker
  → interceptor.js parses the body, contaminates APQ hash
  → Fetch.continueRequest with modified payload
  → Apollo Client retries with full query
  → interceptor.js captures full query, sends to DevTools panel
  → DevTools panel renders the request in the list
```

## Code Style

### Linting & Formatting

The project uses **ESLint** and **Prettier** for consistent code style:

```bash
# Check for lint errors
npm run lint

# Auto-fix lint errors
npm run lint:fix

# Check formatting
npm run format:check

# Auto-format
npm run format
```

### Conventions

- Use `async/await` instead of raw callbacks for Chrome APIs (see `chrome-api.js`)
- Add **JSDoc** comments to all exported functions
- Use descriptive variable names; avoid single-letter variables outside of loop indices
- Keep modules focused — each file should have a single responsibility
- Handle `chrome.runtime.lastError` in every Chrome API callback
- Wrap `JSON.parse` calls in `try/catch`

## Testing

### Unit Tests (Jest)

Unit tests live in `tests/unit/` and cover the service worker and DevTools panel logic:

```bash
npm test
```

### End-to-End Tests (Playwright)

E2E tests live in `tests/e2e/` and test the full extension in a real Chrome instance:

```bash
npm run test:e2e
```

### Writing Tests

- Place unit tests in `tests/unit/` with the naming convention `{module}.test.js`
- Use the Chrome API mocks provided by `jest-chrome` (configured in `tests/unit/setup.js`)
- For DOM-dependent tests, use the `jsdom` environment

## Making Changes

### Branch Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes
3. Run lint and tests:
   ```bash
   npm run lint && npm test
   ```
4. Build the extension and verify manually:
   ```bash
   npm run build
   ```
5. Commit your changes with a descriptive message
6. Push and open a Pull Request

### Commit Messages

Use concise, descriptive commit messages. Prefix with a type when helpful:

- `feat: add request export button`
- `fix: handle empty payload in interceptor`
- `refactor: extract status banner into separate module`
- `test: add unit tests for messaging router`
- `docs: update architecture section in CONTRIBUTING.md`

## Releasing

Releases are automated via GitHub Actions. To publish a new version:

1. Ensure all changes are committed and pushed
2. Bump the version:
   ```bash
   npm version patch   # or minor / major
   ```
   This automatically syncs `manifest.json` and creates a git tag.
3. Push the tag:
   ```bash
   git push --follow-tags
   ```
4. The [release workflow](.github/workflows/release.yml) will build, test, and create a GitHub Release with the packaged `.zip` file.

## Questions?

If you have questions about the codebase or want to discuss a larger change before implementing it, feel free to open an issue.
