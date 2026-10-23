#!/usr/bin/env node

/**
 * Sync the version from package.json into manifest.json.
 *
 * This script is run automatically via the npm `version` lifecycle hook
 * (see the "version" script in package.json). It ensures that manifest.json
 * always stays in sync with the canonical version in package.json.
 *
 * Usage:
 *   node scripts/sync-version.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);

if (manifest.version !== pkg.version) {
  // Replace only the version value so the Prettier layout survives
  // (re-serializing with JSON.stringify expands one-line arrays).
  const updated = manifestText.replace(
    /("version"\s*:\s*)"[^"]*"/,
    (_, key) => `${key}${JSON.stringify(pkg.version)}`
  );
  fs.writeFileSync(manifestPath, updated);
  console.log(`Synced manifest.json version to ${pkg.version}`);
} else {
  console.log(`manifest.json already at version ${pkg.version}`);
}
