import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// Check for production build flag
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

// Wipe dist so stale hashed chunks and prior sourcemaps aren't packaged
fs.rmSync('dist', { recursive: true, force: true });

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
}
if (!fs.existsSync('dist/src/modules')) {
    fs.mkdirSync('dist/src/modules', { recursive: true });
}

const COPY_SKIP_FILE = /\.(js|map)$/;

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
        if (COPY_SKIP_FILE.test(src)) return;
        fs.copyFileSync(src, dest);
    }
}

fs.copyFileSync('index.html', 'dist/index.html');
copyRecursive('assets/ui', 'dist/assets/ui');
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

// Plugin to resolve .bundle.js imports to their source .js files
// so esbuild can properly bundle and deduplicate shared code (e.g. CodeMirror)
const bundleAliasPlugin = {
    name: 'bundle-alias',
    setup(build) {
        build.onResolve({ filter: /\.bundle\.js$/ }, (args) => {
            // Resolve e.g. './responseEditor.bundle.js' → './responseEditor.js'
            const sourceName = args.path.replace('.bundle.js', '.js');
            const resolved = path.resolve(args.resolveDir, sourceName);
            return { path: resolved };
        });
    }
};

await esbuild.build({
    ...sharedBuildOptions,
    entryPoints: [
        'src/renderer.js',
        'src/modules/responseEditor.js',
        'src/modules/jsonEditor.js',
        'src/modules/requestBodyEditor.js',
        'src/modules/graphqlEditor.js',
        'src/modules/scriptEditor.js',
        'src/modules/schemaEditor.js',
    ],
    outdir: 'dist/src',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: '[dir]/[name].bundle',
    plugins: [bundleAliasPlugin],
}).then(() => {
    console.log('✓ Renderer and editor modules bundled with code splitting');
}).catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
});

// Minify CSS in production (overwrites the verbatim copies in dist).
// bundle:false leaves url("../assets/ui/...") references and the runtime
// theme paths (src/themes/<name>.css) untouched.
if (isProduction) {
    const cssFiles = [];
    (function collectCss(dir) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);
            if (fs.statSync(full).isDirectory()) {
                collectCss(full);
            } else if (full.endsWith('.css')) {
                cssFiles.push(full);
            }
        }
    })('src');

    await esbuild.build({
        entryPoints: cssFiles,
        outdir: 'dist/src',
        outbase: 'src',
        bundle: false,
        minify: true,
        loader: { '.css': 'css' },
    }).then(() => {
        console.log(`✓ Minified ${cssFiles.length} CSS file(s)`);
    }).catch((error) => {
        console.error('CSS build failed:', error);
        process.exit(1);
    });
}

// Update index.html in dist to reference the bundled renderer
const indexHtml = fs.readFileSync('dist/index.html', 'utf8');
const updatedHtml = indexHtml.replace(
    '<script type="module" src="./src/renderer.js"></script>',
    '<script type="module" src="./src/renderer.bundle.js"></script>'
);
fs.writeFileSync('dist/index.html', updatedHtml);
console.log('✓ dist/index.html updated to use bundled renderer');

// Print build summary
const chunkDir = 'dist/src/chunks';
if (fs.existsSync(chunkDir)) {
    const chunks = fs.readdirSync(chunkDir).filter(f => f.endsWith('.js'));
    console.log(`  → ${chunks.length} shared chunk(s) created`);
}

if (isProduction) {
    console.log('\n✓ Production build complete (minified, no sourcemaps)');
} else {
    console.log('\n✓ Development build complete (with sourcemaps)');
}
