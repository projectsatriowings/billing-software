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

function randomId(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return `${prefix}_${s}`;
}

async function reset() {
  console.log('=== STARTING COMPLETE COUNTER DATA RESET ===\n');

  // Step 1: Remove obsolete test tenants and their counters/invoices/shifts/branches
  console.log('Step 1: Removing automated test artifacts...');
  const testTenantsRes = await pool.query(`
    SELECT id FROM tenants
    WHERE id LIKE 't_cnt_test_%' OR id LIKE 't_dash_cnt_%' OR id LIKE 't_test_%'
  `);
  const testTenantIds = testTenantsRes.rows.map(r => r.id);
  console.log(`Found ${testTenantIds.length} test tenants to clean.`);

  if (testTenantIds.length > 0) {
    const tables = [
      'sms_logs', 'payments', 'invoice_lines', 'invoices', 'shifts',
      'stock_moves', 'inventory_batches', 'counters', 'number_series',
      'items', 'users', 'branches', 'tenants'
    ];
    for (const tbl of tables) {
      try {
        await pool.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1)`, [testTenantIds]);
      } catch (e) {
        // if table has no tenant_id, or doesn't exist, try id if table is tenants
        if (tbl === 'tenants') {
          try { await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [testTenantIds]); } catch { }
        }
      }
    }
    console.log('Cleaned all test tenant data.');
  }

  // Also clean any counters not matching test tenants but marked as test
  await pool.query(`
    DELETE FROM counters
    WHERE tenant_id LIKE 't_cnt_test_%' OR tenant_id LIKE 't_dash_cnt_%'
  `);

  // Step 2: In demo supermarket (br_main_store), clean temporary test invoices from today
  console.log('\nStep 2: Cleaning today\'s test invoices in br_main_store...');
  const todayInvsRes = await pool.query(`
    SELECT id FROM invoices
    WHERE branch_id = 'br_main_store'
      AND (bdate = '2026-11-11' OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-11-11'::date)
  `);
  const todayInvIds = todayInvsRes.rows.map(r => r.id);
  console.log(`Found ${todayInvIds.length} invoices to delete:`, todayInvIds);

  if (todayInvIds.length > 0) {
    await pool.query('DELETE FROM sms_logs WHERE invoice_id = ANY($1)', [todayInvIds]);
    await pool.query('DELETE FROM payments WHERE invoice_id = ANY($1)', [todayInvIds]);
    await pool.query('DELETE FROM invoice_lines WHERE invoice_id = ANY($1)', [todayInvIds]);
    await pool.query('DELETE FROM invoices WHERE id = ANY($1)', [todayInvIds]);
    console.log('Deleted today\'s test invoices, payments, and lines.');
  }

  // Step 3: Remove temporary counters created today in br_main_store (Counter 3 & Counter 4)
  console.log('\nStep 3: Removing temporary test counters (Counter 3 and Counter 4) in br_main_store...');
  await pool.query(`
    DELETE FROM counters
    WHERE branch_id = 'br_main_store'
      AND id IN ('cnt_EYJuX5u6HZt5oUVU', 'cnt_6fiBqydVgcBR6hXQ')
  `);

  // Reset branches.counters JSON array to only active baseline counters
  await pool.query(`
    UPDATE branches
    SET counters = '["MAIN-C01", "MAIN-C02"]'::jsonb
    WHERE id = 'br_main_store'
  `);
  console.log('Reset branches.counters for br_main_store to ["MAIN-C01", "MAIN-C02"].');

  // Step 4: Reset shifts & user counter assignments
  console.log('\nStep 4: Resetting shifts and cashier assignments...');
  // Close stale shift shf_0FNLOb1ts3vqqEuw
  await pool.query(`
    UPDATE shifts
    SET status = 'closed', closed_at = NOW(), counter_id = NULL
    WHERE id = 'shf_0FNLOb1ts3vqqEuw'
  `);

  // Clear counter_id on open shift
  await pool.query(`
    UPDATE shifts
    SET counter_id = NULL
    WHERE branch_id = 'br_main_store' AND status = 'open'
  `);

  // Clear any assigned counter on users
  await pool.query(`
    UPDATE users
    SET counter_id = NULL, assigned_counter = NULL
    WHERE tenant_id = 't_demo_supermarket'
  `);
  console.log('Cleared cashier assignments and detached shift counters.');

  // Step 5: Seed Section 6 clean baseline:
  // Counter 1: ₹500 (50000 paise)
  // Counter 2: ₹64 (6400 paise)
  // Total: ₹564
  console.log('\nStep 5: Seeding clean baseline billing for Counter 1 (₹500) and Counter 2 (₹64)...');
  const now = new Date();
  const todayStr = '2026-11-11';
  const tenantId = 't_demo_supermarket';
  const branchId = 'br_main_store';
  const userId = 'u_main_cashier';

  // Invoice 1: Counter 1 (50,000 paise = ₹500.00)
  const inv1Id = randomId('inv');
  const tok1 = randomId('tok');
  const calc1 = {
    lines: [{
      pos: 1,
      hsn: '1006',
      name: 'Supermarket Grocery Basket A',
      unit: 'pcs',
      qtyMilli: 1000,
      priceMinor: 50000,
      totalMinor: 50000,
      discountMinor: 0,
      taxRateBp: 0,
      inclusive: true,
      taxableMinor: 50000,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0
    }],
    totalMinor: 50000,
    subtotalMinor: 50000,
    taxableMinor: 50000,
    taxMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    discountMinor: 0,
    roundOffMinor: 0,
    intraState: true,
    ruleVersion: 'IN-GST-1.0',
    explain: ['Line 1: 1 × ₹500.00 = ₹500.00; 0% GST; total ₹500.00']
  };

  await pool.query(`
    INSERT INTO invoices (
      id, tenant_id, branch_id, client_id, number, kind, status, bdate,
      place_state, intra, subtotal_minor, discount_minor, taxable_minor,
      cgst_minor, sgst_minor, igst_minor, round_off_minor, rounding_minor,
      total_minor, paid_minor, balance_minor, payment_status, rule_version,
      calc, share_token, created_by, location, counter, counter_id,
      counter_name_snapshot, created_at, custom
    ) VALUES (
      $1, $2, $3, $4, $5, 'sale', 'posted', $6,
      '33', true, 50000, 0, 50000,
      0, 0, 0, 0, 0,
      50000, 50000, 0, 'paid', '1.0',
      $7::jsonb, $8, $9, 'MAIN', 'MAIN-C01', 'cnt_main_1',
      'Counter 1', $10, '{"tender":{"cashReceivedMinor":50000,"changeReturnedMinor":0}}'::jsonb
    )
  `, [
    inv1Id, tenantId, branchId, randomId('cid'), 'SKS-1030', todayStr,
    JSON.stringify(calc1), tok1, userId, now
  ]);

  await pool.query(`
    INSERT INTO invoice_lines (
      id, tenant_id, invoice_id, pos, item_id, name, hsn, unit,
      qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
      taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
      restock, branch_id
    ) VALUES (
      $1, $2, $3, 1, 'i_rice_5k_main', 'Supermarket Grocery Basket A', '1006', 'pcs',
      1000, 50000, 0, 0, true,
      50000, 0, 0, 0, 50000,
      true, $4
    )
  `, [randomId('inl'), tenantId, inv1Id, branchId]);

  await pool.query(`
    INSERT INTO payments (
      id, tenant_id, branch_id, invoice_id, kind, method, mode,
      amount_minor, status, bdate, created_by, location, counter,
      counter_id, counter_name_snapshot, created_at
    ) VALUES (
      $1, $2, $3, $4, 'receipt', 'cash', 'cash',
      50000, 'posted', $5, $6, 'MAIN', 'MAIN-C01',
      'cnt_main_1', 'Counter 1', $7
    )
  `, [randomId('pay'), tenantId, branchId, inv1Id, todayStr, userId, now]);

  // Invoice 2: Counter 2 (6,400 paise = ₹64.00)
  const inv2Id = randomId('inv');
  const tok2 = randomId('tok');
  const calc2 = {
    lines: [{
      pos: 1,
      hsn: '1905',
      name: 'Supermarket Quick Snack B',
      unit: 'pcs',
      qtyMilli: 1000,
      priceMinor: 6400,
      totalMinor: 6400,
      discountMinor: 0,
      taxRateBp: 0,
      inclusive: true,
      taxableMinor: 6400,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0
    }],
    totalMinor: 6400,
    subtotalMinor: 6400,
    taxableMinor: 6400,
    taxMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    discountMinor: 0,
    roundOffMinor: 0,
    intraState: true,
    ruleVersion: 'IN-GST-1.0',
    explain: ['Line 1: 1 × ₹64.00 = ₹64.00; 0% GST; total ₹64.00']
  };

  await pool.query(`
    INSERT INTO invoices (
      id, tenant_id, branch_id, client_id, number, kind, status, bdate,
      place_state, intra, subtotal_minor, discount_minor, taxable_minor,
      cgst_minor, sgst_minor, igst_minor, round_off_minor, rounding_minor,
      total_minor, paid_minor, balance_minor, payment_status, rule_version,
      calc, share_token, created_by, location, counter, counter_id,
      counter_name_snapshot, created_at, custom
    ) VALUES (
      $1, $2, $3, $4, $5, 'sale', 'posted', $6,
      '33', true, 6400, 0, 6400,
      0, 0, 0, 0, 0,
      6400, 6400, 0, 'paid', '1.0',
      $7::jsonb, $8, $9, 'MAIN', 'MAIN-C02', 'cnt_qXRBabF_ligvpHf8',
      'Counter 2', $10, '{"tender":{"cashReceivedMinor":6400,"changeReturnedMinor":0}}'::jsonb
    )
  `, [
    inv2Id, tenantId, branchId, randomId('cid'), 'SKS-1031', todayStr,
    JSON.stringify(calc2), tok2, userId, now
  ]);

  await pool.query(`
    INSERT INTO invoice_lines (
      id, tenant_id, invoice_id, pos, item_id, name, hsn, unit,
      qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
      taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
      restock, branch_id
    ) VALUES (
      $1, $2, $3, 1, 'i_biscuit_parle_main', 'Supermarket Quick Snack B', '1905', 'pcs',
      1000, 6400, 0, 0, true,
      6400, 0, 0, 0, 6400,
      true, $4
    )
  `, [randomId('inl'), tenantId, inv2Id, branchId]);

  await pool.query(`
    INSERT INTO payments (
      id, tenant_id, branch_id, invoice_id, kind, method, mode,
      amount_minor, status, bdate, created_by, location, counter,
      counter_id, counter_name_snapshot, created_at
    ) VALUES (
      $1, $2, $3, $4, 'receipt', 'cash', 'cash',
      6400, 'posted', $5, $6, 'MAIN', 'MAIN-C02',
      'cnt_qXRBabF_ligvpHf8', 'Counter 2', $7
    )
  `, [randomId('pay'), tenantId, branchId, inv2Id, todayStr, userId, now]);

  console.log('Seeded baseline invoices:');
  console.log('  Counter 1: ₹500 (Invoice SKS-1030)');
  console.log('  Counter 2: ₹64  (Invoice SKS-1031)');
  console.log('  Total:     ₹564');

  // Verify counters and sales
  console.log('\nStep 6: Verifying final state in database:');
  const activeCounters = await pool.query(`
    SELECT id, name, code, status FROM counters
    WHERE branch_id = 'br_main_store'
    ORDER BY code
  `);
  console.log('Active counters in br_main_store:');
  console.table(activeCounters.rows);

  const todayBills = await pool.query(`
    SELECT number, counter, counter_id, counter_name_snapshot, total_minor
    FROM invoices
    WHERE branch_id = 'br_main_store'
      AND (bdate = '2026-11-11' OR (created_at AT TIME ZONE 'Asia/Kolkata')::date = '2026-11-11'::date)
    ORDER BY number
  `);
  console.log('Today bills in br_main_store:');
  console.table(todayBills.rows);

  await pool.end();
  console.log('\n=== COUNTER DATA RESET COMPLETE ===');
}

reset().catch(console.error);
