#!/usr/bin/env node

/**
 * Enhanced build script for APQ Debugger.
 * Uses esbuild for fast ES-module bundling + minification of JS,
 * and Clean-CSS for CSS minification.
 * Outputs a ready-to-load extension into the extension_build/ folder.
 */

const fs = require('fs-extra');
const path = require('path');
const esbuild = require('esbuild');
const CleanCSS = require('clean-css');
const chokidar = require('chokidar');

// ── Configuration ─────────────────────────────────────────────────

const config = {
  sourceDir: __dirname,
  extDir: path.join(__dirname, 'extension_build'),
  js: [
    {
      entry: 'js/sw/index.js',
      outfile: 'service-worker.min.js',
    },
    {
      entry: 'js/ui/index.js',
      outfile: 'devtools.min.js',
    },
  ],
  css: {
    input: 'frontend/devtools.css',
    output: 'devtools.min.css',
    options: {
      level: {
        1: { all: true, normalizeUrls: false },
        2: {
          all: false,
          removeDuplicateRules: true,
          removeDuplicateFontRules: true,
          removeEmpty: true,
        },
      },
      format: 'keep-breaks',
    },
  },
  html: 'frontend/devtools.html',
  manifest: 'manifest.json',
  iconsDir: 'icons',
};

// CLI flags
const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

// ── JS bundling (esbuild) ─────────────────────────────────────────

async function bundleJS(entry, outfile) {
  const inputPath = path.join(config.sourceDir, entry);
  const outputPath = path.join(config.extDir, outfile);

  if (!(await fs.pathExists(inputPath))) {
    console.log(`❌ Entry not found: ${entry}`);
    return;
  }

  console.log(`🔄 Bundling ${entry}...`);

  const result = await esbuild.build({
    entryPoints: [inputPath],
    bundle: true,
    outfile: outputPath,
    format: 'iife',
    target: ['chrome100'],
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
    drop: isDev ? [] : ['debugger'],
    pure: isDev ? [] : ['console.info', 'console.debug'],
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
  });

  // Calculate combined input size from metafile
  let inputSize = 0;
  if (result.metafile) {
    for (const src of Object.values(result.metafile.inputs)) {
      inputSize += src.bytes;
    }
  }

  const outputStat = await fs.stat(outputPath);
  const reduction =
    inputSize > 0 ? (((inputSize - outputStat.size) / inputSize) * 100).toFixed(1) : '?';

  console.log(`✅ ${entry} → ${outfile}`);
  console.log(
    `   ${inputSize} bytes (source) → ${outputStat.size} bytes (${reduction}% reduction)\n`
  );
}

// ── CSS minification (Clean-CSS) ──────────────────────────────────

async function minifyCSS() {
  const inputPath = path.join(config.sourceDir, config.css.input);
  const outputPath = path.join(config.extDir, config.css.output);

  if (!(await fs.pathExists(inputPath))) {
    console.log(`❌ CSS not found: ${config.css.input}`);
    return;
  }

  console.log(`🔄 Processing ${config.css.input}...`);

  const code = await fs.readFile(inputPath, 'utf8');
  const cleanCSS = new CleanCSS(config.css.options);
  const result = cleanCSS.minify(code);

  if (result.errors.length > 0) {
    console.warn(`⚠️  CSS warnings:`, result.errors);
  }

  await fs.writeFile(outputPath, result.styles);

  const originalSize = Buffer.byteLength(code, 'utf8');
  const minifiedSize = Buffer.byteLength(result.styles, 'utf8');
  const reduction = (((originalSize - minifiedSize) / originalSize) * 100).toFixed(1);

  console.log(`✅ ${config.css.input} → ${config.css.output}`);
  console.log(`   ${originalSize} bytes → ${minifiedSize} bytes (${reduction}% reduction)\n`);
}

// ── Asset copying ─────────────────────────────────────────────────

async function copyAssets() {
  const extDir = config.extDir;

  // Copy icons
  const iconsSrc = path.join(config.sourceDir, config.iconsDir);
  const iconsDest = path.join(extDir, config.iconsDir);
  if (await fs.pathExists(iconsSrc)) {
    await fs.copy(iconsSrc, iconsDest);
    console.log('✅ Copied icons/');
  }

  // Copy and patch manifest.json (sync version from package.json)
  const manifestSrc = path.join(config.sourceDir, config.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestSrc, 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(config.sourceDir, 'package.json'), 'utf8'));
  manifest.version = pkg.version;
  manifest.background.service_worker = 'service-worker.min.js';
  manifest.devtools_page = 'devtools.html';
  if (manifest.icons) {
    for (const key of Object.keys(manifest.icons)) {
      manifest.icons[key] = `icons/icon${key}.png`;
    }
  }
  await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('✅ Copied and patched manifest.json');

  // Copy and patch HTML
  const htmlSrc = path.join(config.sourceDir, config.html);
  let html = await fs.readFile(htmlSrc, 'utf8');
  html = html.replace(
    /<link rel="stylesheet"[^>]*href=["'][^"']*devtools(\.min)?\.css["'][^>]*>/,
    '<link rel="stylesheet" href="devtools.min.css">'
  );
  html = html.replace(
    /<script[^>]*src=["'][^"']*devtools(\.min)?\.js["'][^>]*><\/script>/,
    '<script src="devtools.min.js"></script>'
  );
  // Fix icon paths for the flat build output (../icons/ → icons/)
  html = html.replace(/\.\.\/icons\//g, 'icons/');
  await fs.writeFile(path.join(extDir, 'devtools.html'), html);
  console.log('✅ Copied and patched devtools.html');
}

// ── Main build ────────────────────────────────────────────────────

async function build() {
  console.log('🔨 Starting esbuild-powered build...\n');
  const startTime = Date.now();

  await fs.ensureDir(config.extDir);

  // Bundle all JS entry points in parallel
  await Promise.all(config.js.map(({ entry, outfile }) => bundleJS(entry, outfile)));

  // Minify CSS
  await minifyCSS();

  // Copy static assets
  await copyAssets();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🎉 Build completed in ${duration}s!`);
  console.log('📦 Extension files are ready in the extension_build/ folder.');
}

// ── Watch mode ────────────────────────────────────────────────────

async function watch() {
  console.log('👀 Starting watch mode...\n');

  // Run an initial full build
  await build();

  const watcher = chokidar.watch(
    ['js/**/*.js', 'frontend/*.css', 'frontend/devtools.html', 'manifest.json', 'icons/*'],
    {
      ignored: [/\.min\.(js|css)$/, /node_modules/, /extension_build/],
      persistent: true,
    }
  );

  watcher.on('change', async (filePath) => {
    const relativePath = path.relative(config.sourceDir, filePath);
    console.log(`\n📝 File changed: ${relativePath}`);
    await build();
  });

  console.log('Watching for changes... (Press Ctrl+C to stop)\n');
}

// ── CLI entry point ───────────────────────────────────────────────

if (isWatch) {
  watch();
} else {
  build();
}

module.exports = { build, watch };
