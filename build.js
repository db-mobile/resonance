import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// Check for production build flag
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
}
if (!fs.existsSync('dist/src/modules')) {
    fs.mkdirSync('dist/src/modules', { recursive: true });
}
if (!fs.existsSync('dist/assets')) {
    fs.mkdirSync('dist/assets', { recursive: true });
}

// Copy static files to dist
function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    
    if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        for (const file of fs.readdirSync(src)) {
            copyRecursive(path.join(src, file), path.join(dest, file));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

// Copy index.html and assets
fs.copyFileSync('index.html', 'dist/index.html');
copyRecursive('assets', 'dist/assets');
copyRecursive('src', 'dist/src');

console.log('✓ Static files copied to dist/');

// Shared build options
const sharedBuildOptions = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    sourcemap: !isProduction,
    minify: isProduction,
    treeShaking: true,
};

// Build all editor modules together with code splitting
// This allows esbuild to automatically deduplicate shared CodeMirror code
await esbuild.build({
    ...sharedBuildOptions,
    entryPoints: [
        'src/modules/responseEditor.js',
        'src/modules/jsonEditor.js',
        'src/modules/requestBodyEditor.js',
        'src/modules/graphqlEditor.js',
        'src/modules/scriptEditor.js',
        'src/modules/schemaEditor.js',
    ],
    outdir: 'dist/src/modules',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: '[name].bundle',
}).then(() => {
    console.log('✓ All editor modules bundled with code splitting');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});

// Print build summary
const chunkDir = 'dist/src/modules/chunks';
if (fs.existsSync(chunkDir)) {
    const chunks = fs.readdirSync(chunkDir);
    console.log(`  → ${chunks.length} shared chunk(s) created`);
}

if (isProduction) {
    console.log('\n✓ Production build complete (minified, no sourcemaps)');
} else {
    console.log('\n✓ Development build complete (with sourcemaps)');
}
