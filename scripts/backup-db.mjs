import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables from .env
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is not defined in .env');
  process.exit(1);
}

const backupDir = path.join(projectRoot, 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonBackupPath = path.join(backupDir, `db-backup-${timestamp}.json`);
const sqlBackupPath = path.join(backupDir, `db-backup-${timestamp}.sql`);

async function runBackup() {
  console.log('Connecting to PostgreSQL database...');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const client = await pool.connect();
    console.log('Connected successfully!');

    // Fetch list of user tables in the public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tableNames = tablesRes.rows.map((r) => r.table_name);
    console.log(`Found ${tableNames.length} tables to back up: ${tableNames.join(', ')}`);

    const backupData = {
      timestamp: new Date().toISOString(),
      database: 'neondb',
      tableCount: tableNames.length,
      tables: {},
    };

    let sqlDump = `-- Database Backup: ${new Date().toISOString()}\n`;
    sqlDump += `-- Total Tables: ${tableNames.length}\n\n`;

    for (const tableName of tableNames) {
      const rowsRes = await client.query(`SELECT * FROM "${tableName}"`);
      backupData.tables[tableName] = {
        rowCount: rowsRes.rows.length,
        rows: rowsRes.rows,
      };

      console.log(`  -> Backed up "${tableName}": ${rowsRes.rows.length} rows`);

      if (rowsRes.rows.length > 0) {
        sqlDump += `-- Table: ${tableName} (${rowsRes.rows.length} rows)\n`;
        for (const row of rowsRes.rows) {
          const cols = Object.keys(row);
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const valList = cols
            .map((c) => {
              const v = row[c];
              if (v === null || v === undefined) return 'NULL';
              if (typeof v === 'number' || typeof v === 'boolean') return `${v}`;
              if (v instanceof Date) return `'${v.toISOString()}'`;
              if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
              return `'${String(v).replace(/'/g, "''")}'`;
            })
            .join(', ');

          sqlDump += `INSERT INTO "${tableName}" (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;\n`;
        }
        sqlDump += '\n';
      }
    }

    client.release();
    await pool.end();

    // Write JSON format
    fs.writeFileSync(jsonBackupPath, JSON.stringify(backupData, null, 2), 'utf8');
    // Write SQL format
    fs.writeFileSync(sqlBackupPath, sqlDump, 'utf8');

    console.log('\n========================================');
    console.log('Database backup completed successfully!');
    console.log(`JSON Backup: ${jsonBackupPath}`);
    console.log(`SQL Backup:  ${sqlBackupPath}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Backup failed:', error);
    process.exit(1);
  }
}

runBackup();
