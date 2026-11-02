import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const backupDir = path.resolve('backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `pg_dump_${timestamp}.sql`);
const pgDumpPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';

console.log(`Executing pg_dump to ${backupFile}...`);
try {
  execSync(`"${pgDumpPath}" --dbname="${dbUrl}" -F p -f "${backupFile}"`, { stdio: 'inherit' });
  console.log(`Full pg_dump successful: ${backupFile}`);
} catch (err) {
  console.error('pg_dump failed', err);
  process.exit(1);
}

