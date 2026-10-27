import './../server/src/env.ts';
import { connectDb } from '../server/src/db/index.ts';
import { hashPassword } from '../server/src/security.ts';

async function run() {
  const db = await connectDb();
  const hash = hashPassword('Password123!');
  const tenantId = 't_demo_supermarket';

  // 1. Manager
  const existingMgr = await db.query('SELECT id FROM users WHERE email = ?', ['manager@billing.local']);
  if (existingMgr.length === 0) {
    await db.query(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role, active, assigned_location, allowed_locations)
       VALUES ('u_demo_manager', ?, 'Kavitha Raman (Store Manager)', 'manager@billing.local', ?, 'manager', true, 'MAIN', '["MAIN","GODOWN"]'::jsonb)`,
      [tenantId, hash]
    );
    console.log('Seeded manager@billing.local');
  } else {
    await db.query(`UPDATE users SET password_hash = ?, role = 'manager', assigned_location = 'MAIN', active = true WHERE email = ?`, [hash, 'manager@billing.local']);
    console.log('Updated manager@billing.local');
  }

  // 2. Cashier
  const existingCsh = await db.query('SELECT id FROM users WHERE email = ?', ['cashier@billing.local']);
  if (existingCsh.length === 0) {
    await db.query(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role, active, assigned_location, assigned_counter, allowed_locations)
       VALUES ('u_demo_cashier', ?, 'Ravi Kumar (Cashier)', 'cashier@billing.local', ?, 'cashier', true, 'MAIN', 'COUNTER-1', '["MAIN"]'::jsonb)`,
      [tenantId, hash]
    );
    console.log('Seeded cashier@billing.local');
  } else {
    await db.query(`UPDATE users SET password_hash = ?, role = 'cashier', assigned_location = 'MAIN', assigned_counter = 'COUNTER-1', active = true WHERE email = ?`, [hash, 'cashier@billing.local']);
    console.log('Updated cashier@billing.local');
  }

  // 3. Make sure branches have manager and counters assigned properly
  await db.query(
    `UPDATE branches SET manager_id = 'u_demo_manager' WHERE tenant_id = ? AND code = 'MAIN'`,
    [tenantId]
  );
  console.log('Linked manager to MAIN branch');

  await db.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
