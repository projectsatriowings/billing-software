import crypto from 'node:crypto';

/** Short random id with a readable prefix, e.g. u_x8Fk2... (url-safe, unguessable). */
export const newId = (prefix: string): string => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

// ---------------------------------------------------------------- passwords (scrypt, built in: no extra package)
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/** Used so a login attempt for an unknown email takes about as long as a real one. */
const DUMMY_HASH = hashPassword('not-a-real-password');
export const burnPasswordTime = (password: string) => { verifyPassword(password, DUMMY_HASH); };

const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'abcd1234', '11111111', 'password123']);
/** Returns a plain-language problem, or null when the password is acceptable. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password is too long (maximum 128 characters)';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be one repeated character';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Please choose another';
  return null;
}

// ---------------------------------------------------------------- signed login tokens (HS256 JWT)
export interface TokenPayload { sub: string; tid: string; ph: string; iat: number; exp: number }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data: string, secret: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(p: { sub: string; tid: string; ph: string }, secret: string, ttlSeconds: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ ...p, iat: nowSec, exp: nowSec + ttlSeconds });
  return `${head}.${body}.${sign(`${head}.${body}`, secret)}`;
}

export function verifyToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const want = Buffer.from(sign(`${head}.${body}`, secret));
  const have = Buffer.from(sig);
  if (want.length !== have.length || !crypto.timingSafeEqual(want, have)) return null;
  try {
    const h = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    if (h.alg !== 'HS256') return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof p.sub !== 'string' || typeof p.tid !== 'string' || typeof p.exp !== 'number' || p.exp <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * A short fingerprint of the stored password hash, carried inside every token.
 * Changing or resetting a password changes the fingerprint, so older tokens stop working (session revocation).
 */
export const passwordStamp = (passwordHash: string): string => crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
