#!/usr/bin/env node

/**
 * Verify production bundle sizes stay within declared budgets.
 * Run after `npm run build`.
 */

const fs = require('fs');
const path = require('path');

/** Max bytes per artifact in extension_build/ */
const BUDGETS = {
  'devtools.min.js': 45000,
  'service-worker.min.js': 25000,
};

const extDir = path.join(__dirname, '..', 'extension_build');

let failed = false;

for (const [file, maxBytes] of Object.entries(BUDGETS)) {
  const filePath = path.join(extDir, file);

  if (!fs.existsSync(filePath)) {
    console.error(`Missing build artifact: ${file} (run npm run build first)`);
    failed = true;
    continue;
  }

  const size = fs.statSync(filePath).size;
  const status = size <= maxBytes ? 'OK' : 'FAIL';

  console.log(`${status}  ${file}: ${size} bytes (budget ${maxBytes})`);

  if (size > maxBytes) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
