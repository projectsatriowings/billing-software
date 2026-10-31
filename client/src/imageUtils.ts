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
 * - https://drive.google.com/file/d/<FILE_ID>/view
 * - https://drive.google.com/file/d/<FILE_ID>/edit
 * - https://drive.google.com/open?id=<FILE_ID>
 * - https://drive.google.com/uc?id=<FILE_ID>
 * - https://drive.google.com/thumbnail?id=<FILE_ID>
 * - https://docs.google.com/file/d/<FILE_ID>/...
 * - https://docs.google.com/uc?id=<FILE_ID>
 * - Direct CDN URLs: https://lh3.googleusercontent.com/d/<FILE_ID>
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
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/open\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/thumbnail\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
  ];

  for (const pattern of drivePatterns) {
    const match = str.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
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
