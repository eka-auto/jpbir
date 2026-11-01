import { build } from 'esbuild';

export async function buildAuth() {
  await build({
    entryPoints: ['Frontend/signup.js'],
    outfile: 'Frontend/assets/signup.bundle.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    supported: { 'template-literal': false },
    minify: true,
    legalComments: 'eof',
  });
}

await buildAuth();
