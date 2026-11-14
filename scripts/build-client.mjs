import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function build() {
  const distDir = path.resolve('client/dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy public assets
  const publicDir = path.resolve('client/public');
  if (fs.existsSync(publicDir)) {
    for (const f of fs.readdirSync(publicDir)) {
      fs.copyFileSync(path.join(publicDir, f), path.join(distDir, f));
    }
  }

  console.log('Bundling client with esbuild...');
  await esbuild.build({
    entryPoints: ['client/src/index.tsx'],
    bundle: true,
    outfile: 'client/dist/bundle.js',
    minify: process.env.NODE_ENV === 'production',
    sourcemap: true,
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    },
  });

  console.log('✅ Client built successfully to client/dist');
}

build().catch((err) => {
  console.error('Client build failed:', err);
  process.exit(1);
});
