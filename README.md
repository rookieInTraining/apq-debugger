<p align="center">
   <img src="./icons/icon128.png" style="padding: 20px;">
</p>

# APQ Debugger — Chrome extension for Apollo GraphQL Persisted Queries (APQ)

**APQ Debugger** reveals the full GraphQL operation behind Apollo Client’s Automatic Persisted Queries (APQ) hashes and visualizes the fallback flow in Chrome DevTools.
[→ Install from Chrome Web Store](https://chromewebstore.google.com/detail/apq-debugger-beta/gbanmonipiommdljkadhhiomhkgjchee)

## Features

- 🔍 **Network Interception**: Intercept and modify GraphQL requests in real-time
- 🎯 **Pattern Matching**: Use URL patterns to target specific GraphQL endpoints
- 🛠️ **DevTools Integration**: Seamless integration with Chrome DevTools

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the project folder
5. Open DevTools and look for the "APQ Debugger" panel

## Usage

1. Navigate to the target page with Apollo Client
2. Open Chrome DevTools and go to the "APQ Debugger" panel
3. Add URL patterns to match GraphQL endpoints (e.g., `/graphql`, `*api*`)
4. Click "Start Debugging" to begin interception
5. Intercepted requests will trigger twice:
   - First: Failing due to `PersistedQueryNotFound`
   - Second: Containing the full GraphQL query

## File Structure

```
apq-debugger/
├── frontend/
│   ├── devtools.html          # Main DevTools panel HTML
│   ├── devtools.css           # Development CSS
│   └── devtools.min.css       # Minified CSS (production)
├── js/
│   ├── devtools.js            # Development JavaScript
│   ├── devtools.min.js        # Minified JavaScript (production)
│   ├── service-worker.js      # Development service worker
│   └── service-worker.min.js  # Minified service worker (production)
├── icons/                     # Extension icons
├── manifest.json              # Extension manifest
├── package.json               # Node.js dependencies
├── build.js                   # Simple build script
├── build-enhanced.js          # Enhanced build script with libraries
├── install-deps.js            # Dependency installation helper
└── README.md                  # This file
```

## Development

### Quick Start

1. **Install dependencies** (optional, for enhanced builds):
   ```bash
   node install-deps.js
   # or manually:
   npm install
   ```

2. **Build minified files**:
   ```bash
   # Simple build (no dependencies required)
   node build.js
   
   # Enhanced build (requires dependencies)
   npm run build
   # or
   node build-enhanced.js
   ```

3. **Watch mode for development**:
   ```bash
   npm run watch
   # or
   node build-enhanced.js --watch
   ```

### Build Options

#### Simple Build (No Dependencies)
- **Command**: `node build.js`
- **Features**: Basic regex-based minification
- **Pros**: No dependencies required
- **Cons**: Limited optimization

#### Enhanced Build (With Dependencies)
- **Command**: `npm run build` or `node build-enhanced.js`
- **Features**: Professional minification using Terser and Clean-CSS
- **Pros**: Better compression, dead code elimination, advanced optimizations
- **Cons**: Requires Node.js dependencies

### Build Libraries Used

- **Terser**: JavaScript minification with ES6+ support
- **Clean-CSS**: Advanced CSS optimization
- **Chokidar**: File watching for development
- **fs-extra**: Enhanced file system operations

### File Organization

- **Development files**: Use `.js` and `.css` extensions
- **Production files**: Use `.min.js` and `.min.css` extensions
- The extension automatically uses minified files for better performance

## Technical Details

### How It Works

1. **Pattern Matching**: Uses Chrome's Fetch API to intercept requests matching specified URL patterns
2. **Query Modification**: Replaces SHA256 hashes with full GraphQL queries in APQ requests
3. **Request Continuation**: Modifies and continues intercepted requests with the full query payload
4. **Real-time Monitoring**: Provides live feedback on intercepted requests and debugger status

### Architecture

- **DevTools Panel**: User interface for configuration and monitoring
- **Service Worker**: Background process handling network interception
- **Chrome Debugger API**: Used for request interception and modification
- **Message Passing**: Communication between DevTools panel and service worker

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the appropriate build command:
   - `node build.js` (simple)
   - `npm run build` (enhanced)
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.