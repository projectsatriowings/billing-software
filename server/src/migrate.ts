import './env.ts'; // loads .env
import { connectDb, migrate } from './db/index.ts';

const db = await connectDb();
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is already up to date.');
} finally {
  await db.close();
}
