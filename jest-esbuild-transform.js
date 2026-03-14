/**
 * Lightweight Jest transform that uses esbuild to convert ES modules to CJS.
 * This allows Jest (which runs in Node/CJS) to import the ES-module source files.
 */

const { transformSync } = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    const { code } = transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'node14',
      sourcefile: sourcePath,
    });
    return { code };
  },
};
