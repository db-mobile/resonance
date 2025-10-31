import esbuild from 'esbuild';

// Build the responseEditor module and its dependencies
esbuild.build({
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
