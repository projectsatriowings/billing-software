import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Starts a throw-away local PostgreSQL (trust auth, fsync off) for tests and deletes it afterwards.
 * It never connects to any other database, so tests can never touch your Neon data.
 * Needs the PostgreSQL server binaries (initdb, pg_ctl). Set PG_BIN to their folder if they are not found.
 */
function findBin(): string | null {
  const cands = [process.env.PG_BIN ?? ''];
  const isWin = process.platform === 'win32';
  try {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pgDir = path.join(pf, 'PostgreSQL');
    if (fs.existsSync(pgDir)) {
      for (const v of fs.readdirSync(pgDir).sort().reverse()) {
        cands.push(path.join(pgDir, v, 'bin'));
      }
    }
  } catch { /* none */ }
  try {
    for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) cands.push(`/usr/lib/postgresql/${v}/bin`);
  } catch { /* none */ }
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()); } catch { /* none */ }
  cands.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  const hasExe = (dir: string, name: string) => {
    try {
      const p = path.join(dir, name);
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return true;
      if (isWin) {
        const pe = path.join(dir, `${name}.exe`);
        if (fs.existsSync(pe) && !fs.statSync(pe).isDirectory()) return true;
      }
    } catch { /* ignore */ }
    return false;
  };
  return cands.find((c) => c && hasExe(c, 'initdb') && hasExe(c, 'pg_ctl')) ?? null;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });

export interface TestDb { url: string; stop(): void }

/** Returns null when no PostgreSQL server binaries are installed (tests then skip with a clear message). */
export async function startTestDb(): Promise<TestDb | null> {
  const bin = findBin();
  if (!bin) return null;
  const isWin = process.platform === 'win32';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-pg-'));
  const data = path.join(root, 'data');
  const log = path.join(root, 'pg.log');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const exe = (cmd: string) => path.join(bin, isWin ? `${cmd}.exe` : cmd);
  let run = (cmd: string, args: string[]) => execFileSync(exe(cmd), args, { stdio: 'ignore' });
  if (asRoot) {
    // PostgreSQL refuses to run as root: hand the folder to the "postgres" user and run commands as them.
    const uid = Number(execFileSync('id', ['-u', 'postgres'], { encoding: 'utf8' }));
    const gid = Number(execFileSync('id', ['-g', 'postgres'], { encoding: 'utf8' }));
    fs.chownSync(root, uid, gid);
    run = (cmd, args) => execFileSync('runuser', ['-u', 'postgres', '--', exe(cmd), ...args], { stdio: 'pipe' });
  }
  const port = await freePort();
  const initArgs = isWin
    ? ['-D', data, '-A', 'trust', '-U', 'postgres', '-N', '-E', 'UTF8', '--locale=C']
    : ['-D', data, '-A', 'trust', '-U', 'postgres', '-N'];
  run('initdb', initArgs);
  const opts = isWin
    ? `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=60`
    : `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=60`;
  run('pg_ctl', ['-D', data, '-l', log, '-w', '-o', opts, 'start']);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop() {
      try { run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); } catch { /* already stopped */ }
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
    },
  };
}
