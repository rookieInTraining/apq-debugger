#!/usr/bin/env node

/**
 * Package the built extension into a .zip file suitable for Chrome Web Store upload.
 *
 * Expects extension_build/ to exist (run `npm run build` first).
 * The output file is named apq-debugger-v{version}.zip and placed in the project root.
 *
 * Usage:
 *   node scripts/package-extension.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'extension_build');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outputName = `apq-debugger-v${pkg.version}.zip`;
const outputPath = path.join(rootDir, outputName);

if (!fs.existsSync(buildDir)) {
  console.error('extension_build/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Remove existing zip if present
if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
}

try {
  if (process.platform === 'win32') {
    // PowerShell Compress-Archive (available on Windows 10+)
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${buildDir}\\*' -DestinationPath '${outputPath}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    // Unix zip command
    execSync(`cd "${buildDir}" && zip -r "${outputPath}" .`, {
      stdio: 'inherit',
    });
  }

  const stats = fs.statSync(outputPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`${outputName} created (${sizeKB} KB)`);
} catch (error) {
  console.error('Failed to create zip:', error.message);
  process.exit(1);
}
