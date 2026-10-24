import fs from 'node:fs';
import http from 'node:http';
import { env } from './env.ts'; // must be first: it loads .env before anything reads process.env
import { connectDb, migrate } from './db/index.ts';
import { createApp } from './app.ts';

async function main() {
  const db = await connectDb();
  const applied = await migrate(db);
  if (applied.length) console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', versions: applied }));

  const staticDir = fs.existsSync(env.staticDir) ? env.staticDir : undefined;
  const server = http.createServer(createApp(db, { secret: env.jwtSecret, ttlSeconds: env.jwtTtlSeconds, staticDir }));
  server.keepAliveTimeout = 65_000;
  server.listen(env.port, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'billing server started', port: env.port, driver: db.driver, serving: staticDir ? 'api + web app' : 'api only' }));
  });

  const stop = () => server.close(() => { db.close().finally(() => process.exit(0)); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'fatal', msg: String(e?.message ?? e) }));
  process.exit(1);
});
