import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    target: 'node18',
    external: ['vscode'], // Exclude 'vscode' from the bundle
    format: 'cjs',
    sourcemap: true,
    ...(isWatch && {
        watch: {
            onRebuild(error) {
                if (error) console.error('watch build failed:', error);
                else console.log('watch build succeeded');
            },
        },
    }),
};

esbuild.build(extensionConfig).catch((err) => {
    console.error(err);
    process.exit(1);
});
