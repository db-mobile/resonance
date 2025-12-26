import esbuild from 'esbuild';

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
