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

let activeTunnelUrl = process.env.SCANNER_TUNNEL_URL || 'https://books-strike-objectives-holdem.trycloudflare.com';

export function setTunnelUrl(url: string) {
  activeTunnelUrl = url.trim();
}

export function getTunnelUrl(): string {
  return activeTunnelUrl;
}

export function registerScannerBridge(r: Router) {
  // 1. Get network IP & ports for mobile pairing QR code
  r.get('/api/scanner/network-info', (ctx: Ctx) => {
    const localIp = getLocalIpAddress();
    const availableIps = getAllLocalIps();
    const httpPort = Number(process.env.PORT ?? 3001);
    const httpsPort = httpPort + 443;
    return {
      localIp,
      availableIps,
      httpPort,
      httpsPort,
      tunnelUrl: activeTunnelUrl,
      serverTime: Date.now(),
    };
  });

  // 1b. Update or configure public tunnel URL
  r.post('/api/scanner/tunnel', (ctx: Ctx) => {
    if (ctx.body?.url) {
      activeTunnelUrl = String(ctx.body.url).trim();
    }
    return { ok: true, tunnelUrl: activeTunnelUrl };
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
