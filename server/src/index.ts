import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import { env } from './env.ts'; // must be first: it loads .env before anything reads process.env
import { connectDb, migrate } from './db/index.ts';
import { createApp } from './app.ts';

// Guard process against unhandled socket resets (e.g. ECONNRESET on idle postgres connection drops)
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'ECONNRESET' || err?.message?.includes('ECONNRESET')) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'Handled transient socket ECONNRESET', error: err.message }));
    return;
  }
  console.error(JSON.stringify({ level: 'error', msg: 'Uncaught exception', error: err?.stack || err?.message || String(err) }));
});

process.on('unhandledRejection', (reason: any) => {
  console.warn(JSON.stringify({ level: 'warn', msg: 'Handled unhandled promise rejection', error: reason?.message || String(reason) }));
});

async function main() {
  const db = await connectDb();
  const applied = await migrate(db);
  if (applied.length) console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', versions: applied }));

  const staticDir = fs.existsSync(env.staticDir) ? env.staticDir : undefined;
  const app = createApp(db, { secret: env.jwtSecret, ttlSeconds: env.jwtTtlSeconds, staticDir });
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.listen(env.port, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'billing server started', port: env.port, driver: db.driver, serving: staticDir ? 'api + web app' : 'api only' }));
  });

  let httpsServer: https.Server | undefined;
  try {
    const certData = await selfsigned.generate();
    httpsServer = https.createServer({ key: certData.private, cert: certData.cert }, app);
    httpsServer.keepAliveTimeout = 65_000;
    const httpsPort = env.port + 443;
    httpsServer.listen(httpsPort, () => {
      console.log(JSON.stringify({ level: 'info', msg: 'secure mobile scanner https server started', port: httpsPort }));
    });
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'https server could not start, continuing with http only', error: String(err?.message ?? err) }));
  }

  const stop = () => {
    if (httpsServer) httpsServer.close();
    server.close(() => { db.close().finally(() => process.exit(0)); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('unhandledRejection', (reason: any) => {
    console.warn(JSON.stringify({ level: 'warn', msg: 'unhandled rejection intercepted', error: String(reason?.message ?? reason) }));
  });
  process.on('uncaughtException', (err: any) => {
    console.error(JSON.stringify({ level: 'error', msg: 'uncaught exception intercepted', error: String(err?.message ?? err) }));
  });
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'fatal', msg: String(e?.message ?? e) }));
  process.exit(1);
});

