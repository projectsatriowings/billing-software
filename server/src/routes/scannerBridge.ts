import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { Router, Ctx } from '../http.ts';
import { bad } from '../http.ts';

export interface ScanEvent {
  id: string;
  barcode: string;
  timestamp: number;
  deviceInfo?: string;
}

export interface ScannerSession {
  id: string;
  createdAt: number;
  lastSeenPhoneAt?: number;
  deviceInfo?: string;
  scans: ScanEvent[];
  waitingListeners: Array<(events: ScanEvent[]) => void>;
}

const sessions = new Map<string, ScannerSession>();

// Cleanup stale sessions older than 24 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.createdAt > 24 * 60 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

export function getAllLocalIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: { ip: string; priority: number }[] = [];

  for (const name of Object.keys(interfaces)) {
    const isPreferred = /wi-fi|wlan|ethernet|eth|en/i.test(name);
    for (const iface of interfaces[name] || []) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        !iface.address.startsWith('127.') &&
        !iface.address.startsWith('169.254.')
      ) {
        // High priority if Wi-Fi / Ethernet and standard private subnets
        let prio = isPreferred ? 100 : 50;
        if (iface.address.startsWith('192.168.')) prio += 20;
        else if (iface.address.startsWith('10.')) prio += 15;
        ips.push({ ip: iface.address, priority: prio });
      }
    }
  }

  ips.sort((a, b) => b.priority - a.priority);
  return ips.map((x) => x.ip);
}

export function getLocalIpAddress(): string {
  const ips = getAllLocalIps();
  return ips[0] || 'localhost';
}

function loadPersistedTunnelUrl(): string {
  try {
    const file = path.resolve('.scanner-tunnel-url');
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, 'utf8').trim();
    }
  } catch {}
  return '';
}

function savePersistedTunnelUrl(url: string) {
  try {
    const file = path.resolve('.scanner-tunnel-url');
    if (url) {
      fs.writeFileSync(file, url.trim(), 'utf8');
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {}
}

import { spawn, type ChildProcess } from 'node:child_process';

let activeTunnelUrl = process.env.SCANNER_TUNNEL_URL || loadPersistedTunnelUrl();
let activeTunnelProcess: ChildProcess | null = null;
let tunnelLaunchPromise: Promise<string> | null = null;

export async function isTunnelHealthy(url?: string): Promise<boolean> {
  const target = url || activeTunnelUrl;
  if (!target || !target.startsWith('https://')) return false;
  try {
    const res = await fetch(`${target}/api/health`, {
      headers: { 'User-Agent': 'Billing-Tunnel-KeepAlive/1.0' },
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function launchTunnel(port = 3001, force = false): Promise<string> {
  if (tunnelLaunchPromise) {
    return tunnelLaunchPromise;
  }

  tunnelLaunchPromise = (async () => {
    // If not forced and activeTunnelUrl is already healthy, return it directly
    if (!force && activeTunnelUrl) {
      const healthy = await isTunnelHealthy(activeTunnelUrl);
      if (healthy) {
        return activeTunnelUrl;
      }
    }

    return new Promise<string>((resolve, reject) => {
      try {
        if (activeTunnelProcess) {
          try {
            if (process.platform === 'win32' && activeTunnelProcess.pid) {
              spawn('taskkill', ['/pid', activeTunnelProcess.pid.toString(), '/f', '/t']);
            } else {
              activeTunnelProcess.kill();
            }
          } catch {}
          activeTunnelProcess = null;
        }

        const child = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--protocol', 'http2', '--url', `http://localhost:${port}`], {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        activeTunnelProcess = child;

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error('Tunnel startup timed out after 20 seconds'));
          }
        }, 20000);

        const onData = (chunk: Buffer) => {
          const text = chunk.toString();
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const url = match[0];
            setTunnelUrl(url);
            resolve(url);
          }
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });
        child.on('exit', () => {
          if (activeTunnelProcess === child) {
            activeTunnelProcess = null;
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  })().finally(() => {
    tunnelLaunchPromise = null;
  });

  return tunnelLaunchPromise;
}

// Keep Cloudflare Tunnel alive & auto-heal dead tunnels
setInterval(async () => {
  if (activeTunnelUrl && activeTunnelUrl.startsWith('https://')) {
    const alive = await isTunnelHealthy(activeTunnelUrl);
    if (!alive) {
      activeTunnelUrl = '';
      savePersistedTunnelUrl('');
      const port = Number(process.env.PORT ?? 3001);
      launchTunnel(port, true).catch(() => {});
    }
  } else if (!activeTunnelUrl) {
    const port = Number(process.env.PORT ?? 3001);
    launchTunnel(port, false).catch(() => {});
  }
}, 25_000);

export function setTunnelUrl(url: string) {
  activeTunnelUrl = url.trim();
  savePersistedTunnelUrl(activeTunnelUrl);
}

export function getTunnelUrl(): string {
  return activeTunnelUrl;
}

export function registerScannerBridge(r: Router) {
  // 1. Get network IP & ports for mobile pairing QR code
  r.get('/api/scanner/network-info', async (ctx: Ctx) => {
    const localIp = getLocalIpAddress();
    const availableIps = getAllLocalIps();
    const httpPort = Number(process.env.PORT ?? 3001);
    const httpsPort = httpPort + 443;

    let validTunnelUrl = activeTunnelUrl;
    if (activeTunnelUrl) {
      const isAlive = await isTunnelHealthy(activeTunnelUrl);
      if (!isAlive) {
        activeTunnelUrl = '';
        savePersistedTunnelUrl('');
        validTunnelUrl = '';
      }
    }

    // Auto-spawn tunnel in background if not alive so QR code is ready
    if (!validTunnelUrl) {
      launchTunnel(httpPort, false).catch(() => {});
    }

    return {
      localIp,
      availableIps,
      httpPort,
      httpsPort,
      tunnelUrl: validTunnelUrl,
      isTunnelAlive: Boolean(validTunnelUrl),
      serverTime: Date.now(),
    };
  });

  r.get('/api/scanner/recent-scans', (ctx: Ctx) => {
    const list: any[] = [];
    for (const [id, s] of sessions) {
      list.push({ sessionId: id, scans: s.scans.slice(-10) });
    }
    return { list };
  });

  // 1b. Update or configure public tunnel URL
  r.post('/api/scanner/tunnel', (ctx: Ctx) => {
    if (ctx.body?.url) {
      setTunnelUrl(String(ctx.body.url));
    }
    return { ok: true, tunnelUrl: activeTunnelUrl };
  });

  // 1c. Start or restart public tunnel on demand
  r.post('/api/scanner/restart-tunnel', async (ctx: Ctx) => {
    const httpPort = Number(process.env.PORT ?? 3001);
    const force = ctx.body?.force !== false;
    try {
      const url = await launchTunnel(httpPort, force);
      return { ok: true, tunnelUrl: url };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to start tunnel' };
    }
  });

  // 2. Initialize or verify session
  r.post('/api/scanner/session', (ctx: Ctx) => {
    const id = ctx.body?.sessionId || crypto.randomUUID().slice(0, 8);
    let session = sessions.get(id);
    if (!session) {
      session = {
        id,
        createdAt: Date.now(),
        scans: [],
        waitingListeners: [],
      };
      sessions.set(id, session);
    }
    return {
      ok: true,
      sessionId: id,
      phoneConnected: session.lastSeenPhoneAt ? (Date.now() - session.lastSeenPhoneAt < 15000) : false,
      scanCount: session.scans.length,
    };
  });

  // 3. Heartbeat from mobile phone
  r.post('/api/scanner/heartbeat', (ctx: Ctx) => {
    const sessionId = ctx.body?.sessionId;
    if (!sessionId) throw bad('sessionId required');
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        createdAt: Date.now(),
        scans: [],
        waitingListeners: [],
      };
      sessions.set(sessionId, session);
    }
    session.lastSeenPhoneAt = Date.now();
    if (ctx.body?.deviceInfo) session.deviceInfo = ctx.body.deviceInfo;
    return {
      ok: true,
      connected: true,
      timestamp: Date.now(),
    };
  });

  // 4. Submit a scan from mobile phone
  r.post('/api/scanner/scan', (ctx: Ctx) => {
    const { sessionId, barcode, deviceInfo } = ctx.body || {};
    if (!sessionId || !barcode) throw bad('sessionId and barcode required');

    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        createdAt: Date.now(),
        scans: [],
        waitingListeners: [],
      };
      sessions.set(sessionId, session);
    }

    session.lastSeenPhoneAt = Date.now();
    if (deviceInfo) session.deviceInfo = deviceInfo;

    const event: ScanEvent = {
      id: crypto.randomUUID(),
      barcode: String(barcode).trim(),
      timestamp: Date.now(),
      deviceInfo,
    };

    session.scans.push(event);
    if (session.scans.length > 100) session.scans.shift();

    // Wake up all waiting long-poll listeners immediately
    const listeners = session.waitingListeners.splice(0, session.waitingListeners.length);
    for (const listener of listeners) {
      try {
        listener([event]);
      } catch {}
    }

    // Fail-safe delivery: if this session had no listeners, forward to any active desktop terminal session
    if (listeners.length === 0) {
      for (const [otherId, otherSess] of sessions) {
        if (otherId !== sessionId && otherSess.waitingListeners.length > 0) {
          otherSess.scans.push(event);
          const otherListeners = otherSess.waitingListeners.splice(0, otherSess.waitingListeners.length);
          for (const l of otherListeners) {
            try {
              l([event]);
            } catch {}
          }
        }
      }
    }

    return {
      ok: true,
      barcode: event.barcode,
      scanId: event.id,
      timestamp: event.timestamp,
    };
  });

  // 5. Poll or Long-poll events for desktop POS
  r.get('/api/scanner/events', async (ctx: Ctx) => {
    const sessionId = ctx.query?.session;
    if (!sessionId) throw bad('session query param required');

    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        createdAt: Date.now(),
        scans: [],
        waitingListeners: [],
      };
      sessions.set(sessionId, session);
    }

    const afterId = ctx.query?.after;
    const isPhoneActive = Boolean(session.lastSeenPhoneAt && (Date.now() - session.lastSeenPhoneAt < 15000));

    // If afterId is provided, check if there are newer scans
    if (afterId) {
      const idx = session.scans.findIndex((s) => s.id === afterId);
      if (idx !== -1 && idx < session.scans.length - 1) {
        return {
          ok: true,
          events: session.scans.slice(idx + 1),
          phoneConnected: isPhoneActive,
        };
      }
    }

    // No new scans right now -> hold connection for up to 12 seconds
    return new Promise((resolve) => {
      let resolved = false;

      const finish = (events: ScanEvent[]) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const lIdx = session!.waitingListeners.indexOf(finish);
        if (lIdx !== -1) session!.waitingListeners.splice(lIdx, 1);

        resolve({
          ok: true,
          events,
          phoneConnected: Boolean(session!.lastSeenPhoneAt && (Date.now() - session!.lastSeenPhoneAt < 15000)),
        });
      };

      const timer = setTimeout(() => {
        finish([]);
      }, 12000);

      session!.waitingListeners.push(finish);

      ctx.req.on('close', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const lIdx = session!.waitingListeners.indexOf(finish);
        if (lIdx !== -1) session!.waitingListeners.splice(lIdx, 1);
      });
    });
  });
}
