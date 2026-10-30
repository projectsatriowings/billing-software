import type http from 'node:http';
import type { DB } from './db/index.ts';
import { makeAuthenticator } from './auth.ts';
import { createHandler, Router } from './http.ts';
import { registerAuth } from './routes/auth.ts';
import { registerMeta } from './routes/meta.ts';
import { registerShop } from './routes/shop.ts';
import { registerUsers } from './routes/users.ts';
import { registerItems } from './routes/items.ts';
import { registerItemsBulk } from './routes/itemsBulk.ts';
import { registerCategories } from './routes/categories.ts';
import { registerParties } from './routes/parties.ts';
import { registerInvoices } from './routes/invoices.ts';
import { registerCreditNotes } from './routes/creditNotes.ts';
import { registerPurchases } from './routes/purchases.ts';
import { registerReports } from './routes/reports.ts';
import { registerPayments } from './routes/payments.ts';
import { registerInventory } from './routes/inventory.ts';
import { registerShifts } from './routes/shifts.ts';
import { registerBranches } from './routes/branches.ts';
import { registerScannerBridge } from './routes/scannerBridge.ts';
import { registerSalesAnalysis } from './routes/salesAnalysis.ts';
import { registerDashboard } from './routes/dashboard.ts';
import { registerExpenses } from './routes/expenses.ts';
import { registerGst } from './routes/gst.ts';
import { registerHsn } from './routes/hsn.ts';
import { registerCfdBridge } from './routes/cfdBridge.ts';
import { registerPromotions } from './routes/promotions.ts';

/** Every module adds one `registerXxx(r)` line here. Nothing else in the server needs to change. */
export function buildRouter(tokens: { secret: string; ttlSeconds: number }): Router {
  const r = new Router();
  registerMeta(r);
  registerAuth(r, tokens);
  registerShop(r);
  registerUsers(r);
  registerItems(r);
  registerItemsBulk(r);
  registerCategories(r);
  registerParties(r);
  registerCreditNotes(r);
  registerInvoices(r);
  registerPurchases(r);
  registerReports(r);
  registerPayments(r);
  registerInventory(r);
  registerShifts(r);
  registerBranches(r);
  registerScannerBridge(r);
  registerExpenses(r);
  registerGst(r);
  registerHsn(r);
  registerCfdBridge(r);
  registerSalesAnalysis(r);
  registerDashboard(r);
  registerPromotions(r);
  return r;
}

const SEVEN_DAYS = 60 * 60 * 24 * 7;

export function createApp(db: DB, opts: { secret: string; ttlSeconds?: number; staticDir?: string; log?: boolean }): http.RequestListener {
  const router = buildRouter({ secret: opts.secret, ttlSeconds: opts.ttlSeconds ?? SEVEN_DAYS });
  return createHandler({ db, router, authenticate: makeAuthenticator(opts.secret), staticDir: opts.staticDir, log: opts.log });
}
