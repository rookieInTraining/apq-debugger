#!/usr/bin/env node

/**
 * Dependency installation helper for APQ Debugger
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📦 Installing dependencies for APQ Debugger...\n');

const dependencies = [
    'terser@^5.24.0',
    'clean-css@^5.3.2',
    'chokidar@^3.5.3',
    'fs-extra@^11.2.0'
];

try {
    // Check if package.json exists
    const packageJsonPath = path.join(__dirname, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.log('❌ package.json not found. Please run this script from the project root.');
        process.exit(1);
    }

    // Install dependencies
    console.log('Installing dependencies...');
    execSync(`npm install ${dependencies.join(' ')} --save-dev`, {
        stdio: 'inherit',
        cwd: __dirname
    });

    console.log('\n✅ Dependencies installed successfully!');
    console.log('\n📋 Available commands:');
    console.log('  npm run build      - Build minified files');
    console.log('  npm run build:dev  - Build with development options');
    console.log('  npm run watch      - Watch for changes and rebuild');
    console.log('  node build-enhanced.js --watch  - Enhanced build with watch mode');

} catch (error) {
    console.error('\n❌ Failed to install dependencies:', error.message);
    console.log('\n💡 Try running: npm install');
    process.exit(1);
} 