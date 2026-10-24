// Dev/test-only PostgreSQL client using the wire protocol (extended query, text format).
// Supports trust / cleartext / md5 authentication against a LOCAL server. No TLS, no SCRAM.
// Production uses the `pg` package against Neon; this file exists so the whole system can be
// tested against a real Postgres without installing anything.
import net from 'node:net';
import crypto from 'node:crypto';
import { createDB, type DB, type RawConn, type RawPool } from './index.ts';

interface Msg { type: string; body: Buffer }
const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const frame = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), i32(body.length + 4), body]);
};

function tsToIso(t: string): string {
  let s = t.replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(s)) s += 'Z';
  return new Date(s).toISOString();
}
function convert(oid: number, text: string): unknown {
  switch (oid) {
    case 16: return text === 't';
    case 20: case 21: case 23: case 26: case 700: case 701: case 1700: return Number(text);
    case 114: case 3802: return JSON.parse(text);
    case 1114: case 1184: return tsToIso(text);
    default: return text;
  }
}

class WireConn {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private queue: Msg[] = [];
  private waiter: { resolve: (m: Msg) => void; reject: (e: Error) => void } | null = null;
  private dead: Error | null = null;
  busy = false;

  static async open(url: string): Promise<WireConn> {
    const u = new URL(url);
    const c = new WireConn();
    await new Promise<void>((resolve, reject) => {
      c.sock = net.connect({ host: u.hostname || '127.0.0.1', port: Number(u.port || 5432) }, resolve);
      c.sock.once('error', reject);
    });
    c.sock.on('data', (d: Buffer) => { c.buf = Buffer.concat([c.buf, d]); c.pump(); });
    c.sock.on('error', (e) => c.fail(e));
    c.sock.on('close', () => c.fail(new Error('connection closed')));
    const user = decodeURIComponent(u.username || 'postgres');
    const db = u.pathname.replace(/^\//, '') || user;
    const startup = Buffer.concat([i32(196608), cstr('user'), cstr(user), cstr('database'), cstr(db), cstr('client_encoding'), cstr('UTF8'), Buffer.from([0])]);
    c.sock.write(Buffer.concat([i32(startup.length + 4), startup]));
    for (;;) {
      const m = await c.next();
      if (m.type === 'R') {
        const code = m.body.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) c.sock.write(frame('p', cstr(decodeURIComponent(u.password))));
        else if (code === 5) {
          const salt = m.body.subarray(4, 8);
          const md5 = (b: Buffer | string) => crypto.createHash('md5').update(b).digest('hex');
          c.sock.write(frame('p', cstr('md5' + md5(Buffer.concat([Buffer.from(md5(decodeURIComponent(u.password) + user)), salt])))));
        } else throw new Error('wire driver: unsupported authentication (use trust auth locally, or the pg driver)');
      } else if (m.type === 'E') throw parseError(m.body);
      else if (m.type === 'Z') break;
    }
    await c.run("SET TIME ZONE 'UTC'", []);
    return c;
  }

  private pump() {
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) break;
      const msg = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, 1 + len) };
      this.buf = this.buf.subarray(1 + len);
      if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(msg); } else this.queue.push(msg);
    }
  }
  private fail(e: Error) {
    this.dead = this.dead ?? e;
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(e); }
  }
  private next(): Promise<Msg> {
    const m = this.queue.shift();
    if (m) return Promise.resolve(m);
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  async run(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    const enc = params.map((p) => {
      if (p === null || p === undefined) return i32(-1);
      let s: string;
      if (typeof p === 'boolean') s = p ? 'true' : 'false';
      else if (p instanceof Date) s = p.toISOString();
      else if (typeof p === 'object') s = JSON.stringify(p);
      else s = String(p);
      const b = Buffer.from(s, 'utf8');
      return Buffer.concat([i32(b.length), b]);
    });
    this.sock.write(Buffer.concat([
      frame('P', cstr(''), cstr(sql), i16(0)),
      frame('B', cstr(''), cstr(''), i16(0), i16(params.length), ...enc, i16(0)),
      frame('D', Buffer.from('P'), cstr('')),
      frame('E', cstr(''), i32(0)),
      frame('S'),
    ]));
    let fields: { name: string; oid: number }[] = [];
    const rows: any[] = [];
    let tag = '';
    let error: Error | null = null;
    for (;;) {
      const m = await this.next();
      if (m.type === 'T') {
        fields = [];
        let o = 2;
        const n = m.body.readInt16BE(0);
        for (let i = 0; i < n; i++) {
          const end = m.body.indexOf(0, o);
          const name = m.body.toString('utf8', o, end);
          o = end + 1;
          const oid = m.body.readInt32BE(o + 6);
          o += 18;
          fields.push({ name, oid });
        }
      } else if (m.type === 'D') {
        const n = m.body.readInt16BE(0);
        let o = 2;
        const row: any = {};
        for (let i = 0; i < n; i++) {
          const len = m.body.readInt32BE(o);
          o += 4;
          if (len < 0) row[fields[i].name] = null;
          else { row[fields[i].name] = convert(fields[i].oid, m.body.toString('utf8', o, o + len)); o += len; }
        }
        rows.push(row);
      } else if (m.type === 'C') tag = m.body.toString('utf8', 0, m.body.length - 1);
      else if (m.type === 'E') error = parseError(m.body);
      else if (m.type === 'Z') {
        if (error) throw error;
        const last = Number(tag.split(' ').pop());
        return { rows, rowCount: /^(INSERT|UPDATE|DELETE|MERGE)/.test(tag) && Number.isFinite(last) ? last : rows.length };
      }
    }
  }
  close() { try { this.sock.end(frame('X')); } catch { /* ignore */ } }
}

function parseError(body: Buffer): Error & { code?: string; constraint?: string } {
  const f: Record<string, string> = {};
  let o = 0;
  while (o < body.length && body[o] !== 0) {
    const k = String.fromCharCode(body[o]);
    const end = body.indexOf(0, o + 1);
    f[k] = body.toString('utf8', o + 1, end);
    o = end + 1;
  }
  const e: any = new Error(f.M ?? 'database error');
  e.code = f.C;
  e.constraint = f.n;
  e.detail = f.D;
  return e;
}

export async function connectWire(url: string, max = 6): Promise<DB> {
  const idle: WireConn[] = [];
  const all: WireConn[] = [];
  const waiters: ((c: WireConn) => void)[] = [];
  const wrap = (c: WireConn): RawConn => ({
    run: (sql, params) => c.run(sql, params),
    release: () => { const w = waiters.shift(); if (w) w(c); else idle.push(c); },
  });
  const pool: RawPool = {
    async connect() {
      const c = idle.pop();
      if (c) return wrap(c);
      if (all.length < max) {
        const n = await WireConn.open(url);
        all.push(n);
        return wrap(n);
      }
      return wrap(await new Promise<WireConn>((resolve) => waiters.push(resolve)));
    },
    async end() { all.forEach((c) => c.close()); },
  };
  return createDB(pool, 'wire');
}
