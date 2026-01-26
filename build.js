import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

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

// Build the responseEditor module and its dependencies
await esbuild.build({
    entryPoints: ['src/modules/responseEditor.js'],
    bundle: true,
    format: 'esm',
    outfile: 'src/modules/responseEditor.bundle.js',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
}).then(() => {
    console.log('✓ responseEditor bundled successfully');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});

// Build the jsonEditor module and its dependencies
await esbuild.build({
    entryPoints: ['src/modules/jsonEditor.js'],
    bundle: true,
    format: 'esm',
    outfile: 'src/modules/jsonEditor.bundle.js',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
}).then(() => {
    console.log('✓ jsonEditor bundled successfully');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});

// Build the requestBodyEditor module and its dependencies
await esbuild.build({
    entryPoints: ['src/modules/requestBodyEditor.js'],
    bundle: true,
    format: 'esm',
    outfile: 'src/modules/requestBodyEditor.bundle.js',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
}).then(() => {
    console.log('✓ requestBodyEditor bundled successfully');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});

// Build the graphqlEditor module and its dependencies
await esbuild.build({
    entryPoints: ['src/modules/graphqlEditor.js'],
    bundle: true,
    format: 'esm',
    outfile: 'src/modules/graphqlEditor.bundle.js',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
}).then(() => {
    console.log('✓ graphqlEditor bundled successfully');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});
