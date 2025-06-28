#!/usr/bin/env node

/**
 * Enhanced build script for APQ Debugger
 * Uses professional minification libraries for optimal results
 * After minification, moves all important files into the 'ext' folder for packaging.
 */

const fs = require('fs-extra');
const path = require('path');
const { minify } = require('terser');
const CleanCSS = require('clean-css');
const chokidar = require('chokidar');

// Configuration
const config = {
    sourceDir: __dirname,
    extDir: path.join(__dirname, 'ext'),
    files: [
        {
            input: 'js/devtools.js',
            output: 'js/devtools.min.js',
            type: 'js',
            options: {
                compress: {
                    drop_console: false, // Keep console logs for debugging
                    drop_debugger: true,
                    pure_funcs: ['console.info', 'console.debug']
                },
                mangle: {
                    toplevel: false // Don't mangle top-level names for Chrome extension
                },
                format: {
                    comments: false
                }
            }
        },
        {
            input: 'js/service-worker.js',
            output: 'js/service-worker.min.js',
            type: 'js',
            options: {
                compress: {
                    drop_console: false,
                    drop_debugger: true,
                    pure_funcs: ['console.info', 'console.debug']
                },
                mangle: {
                    toplevel: false
                },
                format: {
                    comments: false
                }
            }
        },
        {
            input: 'frontend/devtools.css',
            output: 'frontend/devtools.min.css',
            type: 'css',
            options: {
                level: {
                    1: {
                        all: true,
                        normalizeUrls: false
                    },
                    2: {
                        all: false,
                        removeDuplicateRules: true,
                        removeDuplicateFontRules: true,
                        removeEmpty: true
                    }
                },
                format: 'keep-breaks'
            }
        }
    ],
    html: 'frontend/devtools.html',
    manifest: 'manifest.json',
    iconsDir: 'icons',
};

// Enhanced JavaScript minification using Terser
async function minifyJS(inputPath, outputPath, options = {}) {
    try {
        const code = await fs.readFile(inputPath, 'utf8');
        
        const result = await minify(code, {
            ...options,
            sourceMap: false // Disable source maps for Chrome extension
        });

        if (result.error) {
            throw new Error(`Terser error: ${result.error.message}`);
        }

        await fs.writeFile(outputPath, result.code);
        return result.code;
    } catch (error) {
        console.error(`❌ Error minifying ${inputPath}:`, error.message);
        throw error;
    }
}

// Enhanced CSS minification using Clean-CSS
async function minifyCSS(inputPath, outputPath, options = {}) {
    try {
        const code = await fs.readFile(inputPath, 'utf8');
        
        const cleanCSS = new CleanCSS(options);
        const result = cleanCSS.minify(code);

        if (result.errors.length > 0) {
            console.warn(`⚠️  CSS warnings for ${inputPath}:`, result.errors);
        }

        await fs.writeFile(outputPath, result.styles);
        return result.styles;
    } catch (error) {
        console.error(`❌ Error minifying ${inputPath}:`, error.message);
        throw error;
    }
}

// Process a single file
async function processFile(file) {
    const inputPath = path.join(config.sourceDir, file.input);
    const outputPath = path.join(config.sourceDir, file.output);

    try {
        // Check if input file exists
        if (!await fs.pathExists(inputPath)) {
            console.log(`❌ Input file not found: ${file.input}`);
            return;
        }

        console.log(`🔄 Processing ${file.input}...`);

        let minified;
        if (file.type === 'js') {
            minified = await minifyJS(inputPath, outputPath, file.options);
        } else if (file.type === 'css') {
            minified = await minifyCSS(inputPath, outputPath, file.options);
        } else {
            throw new Error(`Unknown file type: ${file.type}`);
        }

        // Calculate size reduction
        const originalCode = await fs.readFile(inputPath, 'utf8');
        const originalSize = Buffer.byteLength(originalCode, 'utf8');
        const minifiedSize = Buffer.byteLength(minified, 'utf8');
        const reduction = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);

        console.log(`✅ ${file.input} → ${file.output}`);
        console.log(`   ${originalSize} bytes → ${minifiedSize} bytes (${reduction}% reduction)`);

        // Show additional stats for JS files
        if (file.type === 'js') {
            const originalLines = originalCode.split('\n').length;
            const minifiedLines = minified.split('\n').length;
            console.log(`   Lines: ${originalLines} → ${minifiedLines} (${((originalLines - minifiedLines) / originalLines * 100).toFixed(1)}% reduction)\n`);
        } else {
            console.log('');
        }

    } catch (error) {
        console.error(`❌ Failed to process ${file.input}:`, error.message);
    }
}

// Copy and patch HTML, manifest, and assets to ext/
async function copyToExt() {
    const extDir = config.extDir;
    await fs.ensureDir(extDir);
    // Copy icons
    const iconsSrc = path.join(config.sourceDir, config.iconsDir);
    const iconsDest = path.join(extDir, config.iconsDir);
    if (await fs.pathExists(iconsSrc)) {
        await fs.copy(iconsSrc, iconsDest);
        console.log('✅ Copied icons/');
    }
    // Copy and patch manifest.json
    const manifestSrc = path.join(config.sourceDir, config.manifest);
    const manifestDest = path.join(extDir, 'manifest.json');
    let manifest = JSON.parse(await fs.readFile(manifestSrc, 'utf8'));
    manifest.background.service_worker = 'service-worker.min.js';
    manifest.devtools_page = 'devtools.html';
    // Patch icon paths
    if (manifest.icons) {
        for (const key of Object.keys(manifest.icons)) {
            manifest.icons[key] = `icons/icon${key}.png`;
        }
    }
    await fs.writeFile(manifestDest, JSON.stringify(manifest, null, 2));
    console.log('✅ Copied and patched manifest.json');
    // Copy minified JS
    await fs.copy(path.join(config.sourceDir, 'js/devtools.min.js'), path.join(extDir, 'devtools.min.js'));
    await fs.copy(path.join(config.sourceDir, 'js/service-worker.min.js'), path.join(extDir, 'service-worker.min.js'));
    // Copy minified CSS
    await fs.copy(path.join(config.sourceDir, 'frontend/devtools.min.css'), path.join(extDir, 'devtools.min.css'));
    // Copy and patch HTML
    const htmlSrc = path.join(config.sourceDir, config.html);
    const htmlDest = path.join(extDir, 'devtools.html');
    let html = await fs.readFile(htmlSrc, 'utf8');
    // Patch CSS and JS references
    html = html.replace(/<link rel="stylesheet"[^>]*href=["'][^"']*devtools(\.min)?\.css["'][^>]*>/, '<link rel="stylesheet" href="devtools.min.css">');
    html = html.replace(/<script[^>]*src=["'][^"']*devtools(\.min)?\.js["'][^>]*><\/script>/, '<script src="devtools.min.js"></script>');
    await fs.writeFile(htmlDest, html);
    console.log('✅ Copied and patched devtools.html');
}

// Main build function
async function build() {
    console.log('🔨 Starting enhanced build process...\n');

    const startTime = Date.now();

    // Process all files
    for (const file of config.files) {
        await processFile(file);
    }

    // Copy everything to ext/
    await copyToExt();

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`🎉 Build completed in ${duration}s!`);
    console.log('📦 Extension files are ready in the ext/ folder.');
}

// Watch mode for development
async function watch() {
    console.log('👀 Starting watch mode...\n');

    const watcher = chokidar.watch([
        'js/*.js',
        'frontend/*.css',
        'frontend/devtools.html',
        'manifest.json',
        'icons/*'
    ], {
        ignored: /\.min\.(js|css)$/,
        persistent: true
    });

    watcher.on('change', async (filePath) => {
        const relativePath = path.relative(config.sourceDir, filePath);
        console.log(`📝 File changed: ${relativePath}`);
        
        // Find matching file config
        const file = config.files.find(f => f.input === relativePath);
        if (file) {
            await processFile(file);
        }

        await copyToExt();
    });

    console.log('Watching for changes... (Press Ctrl+C to stop)');
}

// CLI argument parsing
const args = process.argv.slice(2);
const isWatch = args.includes('--watch');
const isDev = args.includes('--dev');

if (isWatch) {
    watch();
} else {
    build();
}

module.exports = { build, watch, processFile, copyToExt }; 