import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx !== -1) {
      const k = t.slice(0, idx).trim();
      const v = t.slice(idx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('=== DELETING ALL COUNTERS, COLLECTED VALUES, AND RECREATING EMPTY COUNTERS TABLE ===\n');

  // Step 1: Delete today's test invoices and collected counter values
  console.log('Step 1: Clearing today invoices, payments, and collected values...');
  const todayInvs = await pool.query(`
    SELECT id FROM invoices
    WHERE bdate = '2026-11-11' OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-11-11'::date
  `);
  const todayIds = todayInvs.rows.map(r => r.id);
  console.log(`Found ${todayIds.length} today invoices to delete:`, todayIds);

  if (todayIds.length > 0) {
    try { await pool.query('DELETE FROM sms_logs WHERE invoice_id = ANY($1)', [todayIds]); } catch {}
    await pool.query('DELETE FROM payments WHERE invoice_id = ANY($1)', [todayIds]);
    await pool.query('DELETE FROM invoice_lines WHERE invoice_id = ANY($1)', [todayIds]);
    await pool.query('DELETE FROM invoices WHERE id = ANY($1)', [todayIds]);
    console.log('Deleted today invoices, payments, and invoice_lines.');
  }

  // Step 2: Detach all counter references from existing tables
  console.log('Step 2: Clearing all counter references from users, shifts, invoices, and payments...');
  await pool.query('UPDATE users SET counter_id = NULL, assigned_counter = NULL');
  await pool.query('UPDATE shifts SET counter_id = NULL, counter = NULL, counter_name_snapshot = NULL');
  await pool.query('UPDATE invoices SET counter_id = NULL');
  await pool.query('UPDATE payments SET counter_id = NULL');

  // Clear counters JSON array in all branches
  await pool.query("UPDATE branches SET counters = '[]'::jsonb");
  console.log('Reset branches.counters to [] on all branches.');

  // Step 3: Drop the counters table completely
  console.log('Step 3: Dropping table counters CASCADE...');
  await pool.query('DROP TABLE IF EXISTS counters CASCADE');
  console.log('Table counters dropped.');

  // Step 4: Recreate empty counters table with complete schema and constraints
  console.log('Step 4: Recreating empty counters table...');
  await pool.query(`
    CREATE TABLE counters (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      login_username TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ,
      created_by TEXT,
      UNIQUE (tenant_id, code)
    )
  `);

  // Recreate indexes
  console.log('Recreating indexes on counters...');
  await pool.query('CREATE INDEX counters_tenant_branch ON counters (tenant_id, branch_id)');
  await pool.query('CREATE INDEX counters_tenant_status ON counters (tenant_id, status)');
  await pool.query('CREATE UNIQUE INDEX idx_counters_tenant_branch_code ON counters (tenant_id, branch_id, upper(code))');
  await pool.query('CREATE UNIQUE INDEX idx_counters_tenant_branch_name ON counters (tenant_id, branch_id, lower(name))');
  await pool.query('CREATE INDEX idx_counters_tenant_branch_status ON counters (tenant_id, branch_id, status)');

  // Step 5: Restore foreign key constraints
  console.log('Step 5: Restoring foreign keys referencing counters(id)...');
  await pool.query('ALTER TABLE users ADD CONSTRAINT users_counter_id_fkey FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE invoices ADD CONSTRAINT invoices_counter_id_fkey FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE payments ADD CONSTRAINT payments_counter_id_fkey FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL');
  await pool.query('ALTER TABLE shifts ADD CONSTRAINT shifts_counter_id_fkey FOREIGN KEY (counter_id) REFERENCES counters(id) ON DELETE SET NULL');

  // Step 6: Verify final state
  console.log('\nStep 6: Verifying final state in database:');
  const countRes = await pool.query('SELECT count(*) as count FROM counters');
  console.log(`Counters table row count: ${countRes.rows[0].count} (must be 0)`);

  const brRes = await pool.query('SELECT id, name, code, counters FROM branches');
  console.log('Branches state:');
  console.table(brRes.rows);

  const todayInvsCheck = await pool.query(`
    SELECT count(*) as count FROM invoices
    WHERE bdate = '2026-11-11' OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-11-11'::date
  `);
  console.log(`Today invoices count: ${todayInvsCheck.rows[0].count} (must be 0)`);

  await pool.end();
  console.log('\n=== COMPLETE: COUNTERS TABLE IS NOW FRESH AND EMPTY WITH ZERO VALUES ===');
}

run().catch(console.error);

