import { Router, FileResponse, type Ctx } from '../http.ts';

interface CacheEntry {
  data: Buffer;
  contentType: string;
  expires: number;
}

const imageCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 300;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const SVG_PLACEHOLDER = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>`,
  'utf8'
);

function extractDriveId(input: string): string | null {
  if (!input) return null;
  const str = input.trim();
  const patterns = [
    /drive\.google\.com\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]{20,})/i,
    /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /lh\d*\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i,
  ];
  for (const p of patterns) {
    const m = str.match(p);
    if (m && m[1]) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(str)) return str;
  return null;
}

async function fetchGoogleDriveImage(fileId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const candidateUrls = [
    `https://lh3.googleusercontent.com/d/${fileId}`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ];

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, { headers, redirect: 'follow' });
      if (!resp.ok) continue;

      const ct = resp.headers.get('content-type') || '';
      // If it returned an HTML page (like Google's preview or sign-in page), skip to next candidate
      if (ct.includes('text/html') || ct.includes('application/json')) continue;

      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length > 50) {
        return {
          data: buf,
          contentType: ct.startsWith('image/') ? ct : 'image/jpeg',
        };
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

export function registerDriveProxy(r: Router): void {
  const proxyHandler = async (ctx: Ctx) => {
    const rawId = ctx.params.id || ctx.query.id || ctx.query.url || '';
    const fileId = extractDriveId(rawId);

    if (!fileId) {
      return new FileResponse(SVG_PLACEHOLDER, 'image/svg+xml');
    }

    const now = Date.now();
    const cached = imageCache.get(fileId);
    if (cached && cached.expires > now) {
      ctx.res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      ctx.res.setHeader('Access-Control-Allow-Origin', '*');
      return new FileResponse(cached.data, cached.contentType);
    }

    const fetched = await fetchGoogleDriveImage(fileId);
    if (fetched) {
      if (imageCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = imageCache.keys().next().value;
        if (oldestKey) imageCache.delete(oldestKey);
      }
      imageCache.set(fileId, {
        data: fetched.data,
        contentType: fetched.contentType,
        expires: now + CACHE_TTL_MS,
      });

      ctx.res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      ctx.res.setHeader('Access-Control-Allow-Origin', '*');
      return new FileResponse(fetched.data, fetched.contentType);
    }

    return new FileResponse(SVG_PLACEHOLDER, 'image/svg+xml');
  };

  r.add('GET', '/api/drive-proxy/:id', proxyHandler);
  r.add('GET', '/api/drive-proxy', proxyHandler);
}

