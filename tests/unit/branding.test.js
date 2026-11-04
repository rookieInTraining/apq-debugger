const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('GraphQL Debugger branding', () => {
  test('manifest name and action title', () => {
    const m = JSON.parse(read('manifest.json'));
    expect(m.name).toBe('GraphQL Debugger');
    expect(m.action.default_title).toBe('Toggle GraphQL Debugger');
    expect(m.description.length).toBeLessThanOrEqual(132);
    expect(m.name).not.toMatch(/apollo/i);
  });

  test('no "APQ Debugger" left in shipped sources', () => {
    for (const p of ['js/ui/index.js', 'js/sw/index.js', 'js/sw/messaging.js', 'frontend/devtools.html']) {
      expect(read(p)).not.toMatch(/APQ Debugger/);
    }
  });

  test('storage keys unchanged', () => {
    expect(read('js/sw/storage.js')).toMatch("'apqPatterns'");
    expect(read('js/shared/constants.js')).toMatch("'apqHashRegistry'");
  });
});
