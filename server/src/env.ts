import crypto from 'node:crypto';

// Load .env (Node 22 built-in) when present; real environment variables win.
try { process.loadEnvFile('.env'); } catch { /* no .env file: fine */ }

const production = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret) {
  if (production) throw new Error('JWT_SECRET must be set in production (use a long random string).');
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn(JSON.stringify({ level: 'warn', msg: 'JWT_SECRET not set: using a random one. Everyone is signed out on each restart.' }));
}

export const env = {
  production,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret,
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 24 * 7),
  /** Public base URL used in WhatsApp links. Falls back to the request host. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  staticDir: process.env.STATIC_DIR ?? 'client/dist',
  whatsapp: {
    // Optional: WhatsApp Business Cloud API. Without these the app uses click-to-chat links.
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneId: process.env.WHATSAPP_PHONE_ID ?? '',
    template: process.env.WHATSAPP_TEMPLATE ?? '',
    lang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
  },
};
