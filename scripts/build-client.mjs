import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function build() {
  const distDir = path.resolve('client/dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy index.html
  const publicHtml = path.resolve('client/public/index.html');
  const distHtml = path.resolve(distDir, 'index.html');
  if (fs.existsSync(publicHtml)) {
    fs.copyFileSync(publicHtml, distHtml);
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
