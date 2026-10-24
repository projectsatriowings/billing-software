import { spawn } from 'node:child_process';
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ensure the working directory is always the billing-platform project root
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(rootDir);

async function startDev() {
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

  console.log('Starting esbuild watch mode for client...');
  const ctx = await esbuild.context({
    entryPoints: ['client/src/index.tsx'],
    bundle: true,
    outfile: 'client/dist/bundle.js',
    sourcemap: true,
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
    },
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  });

  await ctx.watch();
  console.log('Client esbuild watcher active.');

  console.log('Starting backend server with tsx and --watch...');
  const server = spawn('node', ['--watch', '--import', 'tsx', 'server/src/index.ts'], {
    stdio: 'inherit',
    env: process.env,
  });

  const cleanup = () => {
    try {
      if (process.platform === 'win32' && server.pid) {
        spawn('taskkill', ['/pid', server.pid.toString(), '/f', '/t']);
      } else {
        server.kill('SIGINT');
      }
    } catch {}
    try { ctx.dispose(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  server.on('close', (code) => {
    try { ctx.dispose(); } catch {}
    process.exit(code || 0);
  });
}

startDev().catch((err) => {
  console.error('Dev failed:', err);
  process.exit(1);
});
