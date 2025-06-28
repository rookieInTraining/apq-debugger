#!/usr/bin/env node

/**
 * Simple build script for APQ Debugger
 * Minifies JavaScript and CSS files
 */

const fs = require('fs');
const path = require('path');

// Simple minification functions
function minifyJS(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
        .replace(/\/\/.*$/gm, '') // Remove single line comments
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\s*([{}:;,=><+\-*/])\s*/g, '$1') // Remove spaces around operators
        .replace(/;\s*}/g, '}') // Remove semicolons before closing braces
        .replace(/,\s*}/g, '}') // Remove commas before closing braces
        .trim();
}

function minifyCSS(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\s*([{}:;,>])\s*/g, '$1') // Remove spaces around CSS operators
        .replace(/;\s*}/g, '}') // Remove semicolons before closing braces
        .trim();
}

// Files to minify
const files = [
    {
        input: 'js/devtools.js',
        output: 'js/devtools.min.js',
        type: 'js'
    },
    {
        input: 'js/service-worker.js',
        output: 'js/service-worker.min.js',
        type: 'js'
    },
    {
        input: 'frontend/devtools.css',
        output: 'frontend/devtools.min.css',
        type: 'css'
    }
];

console.log('🔨 Starting build process...\n');

files.forEach(file => {
    try {
        const inputPath = path.join(__dirname, file.input);
        const outputPath = path.join(__dirname, file.output);
        
        if (!fs.existsSync(inputPath)) {
            console.log(`❌ Input file not found: ${file.input}`);
            return;
        }
        
        const code = fs.readFileSync(inputPath, 'utf8');
        const minified = file.type === 'js' ? minifyJS(code) : minifyCSS(code);
        
        fs.writeFileSync(outputPath, minified);
        
        const originalSize = Buffer.byteLength(code, 'utf8');
        const minifiedSize = Buffer.byteLength(minified, 'utf8');
        const reduction = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
        
        console.log(`✅ ${file.input} → ${file.output}`);
        console.log(`   ${originalSize} bytes → ${minifiedSize} bytes (${reduction}% reduction)\n`);
        
    } catch (error) {
        console.error(`❌ Error processing ${file.input}:`, error.message);
    }
});

console.log('🎉 Build completed!'); 