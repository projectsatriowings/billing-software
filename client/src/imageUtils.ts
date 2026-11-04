import React from 'react';

/**
 * Lightweight client-side image compression, Data URL, and Google Drive URL resolver utilities.
 * Ensures fast image loading, lightweight database storage, and seamless Google Drive image embedding.
 */

export async function fileToOptimizedDataUrl(file: File, maxDim = 600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Selected file is not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image data'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        // White background for transparent PNGs
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch {
          resolve(String(reader.result));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts Google Drive file ID from various Drive URL formats.
 * Supports:
 * - https://drive.google.com/file/d/<FILE_ID>/view?usp=sharing
 * - https://drive.google.com/file/u/0/d/<FILE_ID>/view (multi-account)
 * - https://drive.google.com/file/u/1/d/<FILE_ID>/view
 * - https://drive.google.com/file/d/<FILE_ID>/view
 * - https://drive.google.com/file/d/<FILE_ID>/edit
 * - https://drive.google.com/open?id=<FILE_ID>
 * - https://drive.google.com/uc?id=<FILE_ID>
 * - https://drive.google.com/thumbnail?id=<FILE_ID>
 * - https://docs.google.com/file/d/<FILE_ID>/...
 * - https://docs.google.com/file/u/0/d/<FILE_ID>/...
 * - https://docs.google.com/uc?id=<FILE_ID>
 * - Direct CDN URLs: https://lh3.googleusercontent.com/d/<FILE_ID>
 * - Folder URLs: https://drive.google.com/drive/folders/<FILE_ID>
 * - Raw Google Drive IDs: 25-45 characters alphanumeric
 */
export function extractGoogleDriveFileId(input: string | null | undefined): string | null {
  if (!input) return null;
  let str = String(input).trim();
  if (!str) return null;

  // Clean quotes or Excel HYPERLINK formula
  str = str.replace(/^["']|["']$/g, '').trim();
  const hyperlinkMatch = str.match(/=HYPERLINK\(\s*["']([^"']+)["']/i);
  if (hyperlinkMatch && hyperlinkMatch[1]) {
    str = hyperlinkMatch[1].trim();
  }

  const drivePatterns = [
    /drive\.google\.com\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/file(?:\/u\/\d+)?\/d\/([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]{20,})/i,
    /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /lh\d*\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i,
  ];

  for (const pattern of drivePatterns) {
    const match = str.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Bare Google Drive ID (standard drive IDs are 25-45 characters alphanumeric with - or _)
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(str)) {
    return str;
  }

  return null;
}

/**
 * Converts a Google Drive share link, Dropbox link, or standard image URL into a direct embed URL.
 * If given a Google Drive link, returns a high-speed direct CDN URL (`https://lh3.googleusercontent.com/d/FILE_ID`).
 */
export function resolveDriveImageUrl(input: string | null | undefined): string {
  if (!input) return '';
  let str = String(input).trim();
  if (!str) return '';

  // Clean surrounding quotes or whitespace
  str = str.replace(/^["']|["']$/g, '').trim();

  // Handle Excel HYPERLINK formula: =HYPERLINK("https://...", "...")
  const hyperlinkMatch = str.match(/=HYPERLINK\(\s*["']([^"']+)["']/i);
  if (hyperlinkMatch && hyperlinkMatch[1]) {
    str = hyperlinkMatch[1].trim();
  }

  // 1. Google Drive Link: Extract fileId and transform to direct embed CDN
  const fileId = extractGoogleDriveFileId(str);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  // 2. Dropbox share link transformation: dl=0 -> raw=1
  if (/dropbox\.com\//i.test(str)) {
    if (str.includes('dl=0')) {
      return str.replace('dl=0', 'raw=1');
    }
    if (!str.includes('raw=1')) {
      return str.includes('?') ? `${str}&raw=1` : `${str}?raw=1`;
    }
  }

  return str;
}

/**
 * Check if the URL points to a Google Drive resource
 */
export function isGoogleDriveUrl(input: string | null | undefined): boolean {
  return extractGoogleDriveFileId(input) !== null;
}

export const FALLBACK_PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

/**
 * Self-healing image error handler for Google Drive and external product images.
 * If a Google Drive CDN URL fails (e.g. rate limit, 403 or referrer restriction),
 * it cycles through official fallback endpoints and the local backend proxy before showing the placeholder.
 */
export function handleProductImageError(
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  originalUrl?: string | null
): void {
  const img = e.currentTarget;
  const currentSrc = img.src || '';
  const fileId = extractGoogleDriveFileId(originalUrl || currentSrc);

  if (fileId) {
    const step = parseInt(img.dataset.fallbackStep || '0', 10);
    const fallbacks = [
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
      `/api/drive-proxy/${fileId}`,
      `https://drive.google.com/uc?export=view&id=${fileId}`,
    ];

    if (step < fallbacks.length) {
      img.dataset.fallbackStep = String(step + 1);
      img.src = fallbacks[step];
      return;
    }
  }

  // If not Google Drive or all fallbacks exhausted, show clean SVG placeholder
  img.src = FALLBACK_PLACEHOLDER_SVG;
}
