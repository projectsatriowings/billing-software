import { requirePerm, requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, conflict, notFound, forbidden, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import type { StockTransfer, StockTransferLine, StockTransferStatus, StockMove } from '../../../shared/types.ts';

export function registerStockTransfers(r: Router) {
  // 1. Get filtered list of stock transfers
  r.get('/api/stock-transfers', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;

    const fromBranch = (ctx.query.fromBranch ?? '').trim().toUpperCase();
    const toBranch = (ctx.query.toBranch ?? '').trim().toUpperCase();
    const branch = (ctx.query.branch ?? '').trim().toUpperCase();
    const status = (ctx.query.status ?? 'all').trim().toLowerCase();
    const search = (ctx.query.search ?? '').trim().toLowerCase();
    const fromDate = (ctx.query.from ?? '').trim();
    const toDate = (ctx.query.to ?? '').trim();
    const page = Math.max(1, V.int(ctx.query.page ?? 1, 'Page', { min: 1 }));
    const limit = Math.min(100, Math.max(1, V.int(ctx.query.limit ?? 10, 'Limit', { min: 1, max: 100 })));
    const offset = (page - 1) * limit;

    let whereSql = `WHERE st.tenant_id = ?`;
    const params: unknown[] = [tenantId];

    // Branch scoping for managers & cashiers
    if (role === 'manager') {
      const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
      const placeholders = allowed.map(() => '?').join(', ');
      whereSql += ` AND (st.from_branch IN (${placeholders}) OR st.to_branch IN (${placeholders}))`;
      params.push(...allowed, ...allowed);
    } else if (role === 'cashier') {
      const assigned = ctx.user!.assignedLocation || 'MAIN';
      whereSql += ` AND (st.from_branch = ? OR st.to_branch = ?)`;
      params.push(assigned, assigned);
    }

    if (branch && branch !== 'ALL') {
      whereSql += ` AND (st.from_branch = ? OR st.to_branch = ?)`;
      params.push(branch, branch);
    }
    if (fromBranch && fromBranch !== 'ALL') {
      whereSql += ` AND st.from_branch = ?`;
      params.push(fromBranch);
    }
    if (toBranch && toBranch !== 'ALL') {
      whereSql += ` AND st.to_branch = ?`;
      params.push(toBranch);
    }
    if (status && status !== 'all') {
      whereSql += ` AND st.status = ?`;
      params.push(status);
    }
    if (search) {
      whereSql += ` AND (lower(st.transfer_number) LIKE ? OR lower(COALESCE(st.notes, '')) LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (fromDate) {
      whereSql += ` AND st.transfer_date >= ?`;
      params.push(fromDate);
    }
    if (toDate) {
      whereSql += ` AND st.transfer_date <= ?`;
      params.push(toDate);
    }

    const countRow = await ctx.db.one<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM stock_transfers st
       ${whereSql}`,
      params,
    );
    const total = Number(countRow?.total ?? 0);

    const rows = await ctx.db.query<any>(
      `SELECT 
        st.id,
        st.tenant_id,
        st.transfer_number,
        st.from_branch,
        fb.name AS from_branch_name,
        st.to_branch,
        tb.name AS to_branch_name,
        st.status,
        st.transfer_date,
        st.requested_by,
        u_req.name AS requested_by_name,
        st.approved_by,
        u_app.name AS approved_by_name,
        st.approved_at,
        st.dispatched_by,
        u_disp.name AS dispatched_by_name,
        st.dispatched_at,
        st.received_by,
        u_rec.name AS received_by_name,
        st.received_at,
        st.notes,
        st.created_at,
        st.updated_at,
        COALESCE((SELECT COUNT(*)::int FROM stock_transfer_lines stl WHERE stl.transfer_id = st.id), 0) AS items_count
       FROM stock_transfers st
       LEFT JOIN branches fb ON fb.tenant_id = st.tenant_id AND fb.code = st.from_branch
       LEFT JOIN branches tb ON tb.tenant_id = st.tenant_id AND tb.code = st.to_branch
       LEFT JOIN users u_req ON u_req.id = st.requested_by
       LEFT JOIN users u_app ON u_app.id = st.approved_by
       LEFT JOIN users u_disp ON u_disp.id = st.dispatched_by
       LEFT JOIN users u_rec ON u_rec.id = st.received_by
       ${whereSql}
       ORDER BY st.created_at DESC, st.transfer_number DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const transfers: StockTransfer[] = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId ?? r.tenant_id,
      transferNumber: r.transferNumber ?? r.transfer_number,
      fromBranch: r.fromBranch ?? r.from_branch,
      fromBranchName: r.fromBranchName ?? r.from_branch_name ?? r.fromBranch ?? r.from_branch,
      toBranch: r.toBranch ?? r.to_branch,
      toBranchName: r.toBranchName ?? r.to_branch_name ?? r.toBranch ?? r.to_branch,
      status: (r.status as StockTransferStatus),
      transferDate: r.transferDate ? String(r.transferDate).split('T')[0] : String(r.transfer_date).split('T')[0],
      requestedBy: r.requestedBy ?? r.requested_by,
      requestedByName: r.requestedByName ?? r.requested_by_name ?? 'Staff User',
      approvedBy: r.approvedBy ?? r.approved_by,
      approvedByName: r.approvedByName ?? r.approved_by_name,
      approvedAt: r.approvedAt ?? r.approved_at,
      dispatchedBy: r.dispatchedBy ?? r.dispatched_by,
      dispatchedByName: r.dispatchedByName ?? r.dispatched_by_name,
      dispatchedAt: r.dispatchedAt ?? r.dispatched_at,
      receivedBy: r.receivedBy ?? r.received_by,
      receivedByName: r.receivedByName ?? r.received_by_name,
      receivedAt: r.receivedAt ?? r.received_at,
      notes: r.notes || null,
      itemsCount: Number(r.itemsCount ?? r.items_count ?? 0),
      createdAt: r.createdAt ?? r.created_at,
      updatedAt: r.updatedAt ?? r.updated_at,
    }));

    return {
      transfers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  });

  // 2. Next Transfer Number Preview
  r.get('/api/stock-transfers/next-number', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const series = await ctx.db.one<{ next_no: number }>(
      `SELECT next_no FROM number_series WHERE tenant_id = ? AND series = 'TRF'`,
      [tenantId],
    );
    const nextNo = Number(series?.next_no ?? 1);
    return {
      nextTransferNumber: `TRF-${String(nextNo).padStart(4, '0')}`,
    };
  });

  // 3. Available stock per item for a specific branch
  r.get('/api/stock-transfers/branch-stock', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branch = (ctx.query.branch ?? 'MAIN').trim().toUpperCase();
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, V.int(ctx.query.limit ?? 50, 'Limit', { min: 1, max: 100 })));

    let querySql = `
      SELECT 
        i.id,
        i.name,
        i.sku,
        i.barcode,
        i.unit,
        i.category,
        i.cost_minor,
        i.price_minor,
        i.track_batch,
        COALESCE((
          SELECT SUM(sm.qty_milli)
          FROM stock_moves sm
          WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id AND sm.location = ?
        ), 0)::bigint AS available_stock_milli
      FROM items i
      WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
    `;
    const params: unknown[] = [branch, tenantId];

    if (q) {
      querySql += ` AND (lower(i.name) LIKE ? OR lower(COALESCE(i.sku, '')) LIKE ? OR lower(COALESCE(i.barcode, '')) LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    querySql += ` ORDER BY i.name ASC LIMIT ?`;
    params.push(limit);

    const rows = await ctx.db.query<any>(querySql, params);

    return {
      branch,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku || null,
        barcode: r.barcode || null,
        unit: r.unit || 'pcs',
        category: r.category || 'General',
        costMinor: Number(r.costMinor ?? r.cost_minor ?? 0),
        priceMinor: Number(r.priceMinor ?? r.price_minor ?? 0),
        trackBatch: Boolean(r.trackBatch ?? r.track_batch),
        availableStockMilli: Number(r.availableStockMilli ?? r.available_stock_milli ?? 0),
        availableStockUnits: Number(r.availableStockMilli ?? r.available_stock_milli ?? 0) / 1000,
      })),
    };
  });

  // 4. Get single stock transfer details, lines, and stock movement records
  r.get('/api/stock-transfers/:id', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const transferId = ctx.params.id;

    const row = await ctx.db.one<any>(
      `SELECT 
        st.id,
        st.tenant_id,
        st.transfer_number,
        st.from_branch,
        fb.name AS from_branch_name,
        st.to_branch,
        tb.name AS to_branch_name,
        st.status,
        st.transfer_date,
        st.requested_by,
        u_req.name AS requested_by_name,
        st.approved_by,
        u_app.name AS approved_by_name,
        st.approved_at,
        st.dispatched_by,
        u_disp.name AS dispatched_by_name,
        st.dispatched_at,
        st.received_by,
        u_rec.name AS received_by_name,
        st.received_at,
        st.notes,
        st.created_at,
        st.updated_at
       FROM stock_transfers st
       LEFT JOIN branches fb ON fb.tenant_id = st.tenant_id AND fb.code = st.from_branch
       LEFT JOIN branches tb ON tb.tenant_id = st.tenant_id AND tb.code = st.to_branch
       LEFT JOIN users u_req ON u_req.id = st.requested_by
       LEFT JOIN users u_app ON u_app.id = st.approved_by
       LEFT JOIN users u_disp ON u_disp.id = st.dispatched_by
       LEFT JOIN users u_rec ON u_rec.id = st.received_by
       WHERE st.tenant_id = ? AND st.id = ?`,
      [tenantId, transferId],
    );

    if (!row) throw notFound('Stock transfer not found');

    // Fetch lines
    const lineRows = await ctx.db.query<any>(
      `SELECT 
        stl.id,
        stl.transfer_id,
        stl.item_id,
        i.name AS item_name,
        i.sku AS item_sku,
        i.barcode AS item_barcode,
        stl.qty_milli,
        stl.received_qty_milli,
        stl.discrepancy_milli,
        stl.discrepancy_reason,
        stl.unit,
        stl.batch_no,
        stl.expiry,
        COALESCE((
          SELECT SUM(sm.qty_milli)
          FROM stock_moves sm
          WHERE sm.item_id = stl.item_id AND sm.tenant_id = stl.tenant_id AND sm.location = ?
        ), 0)::bigint AS available_stock_milli
       FROM stock_transfer_lines stl
       JOIN items i ON i.id = stl.item_id AND i.tenant_id = stl.tenant_id
       WHERE stl.tenant_id = ? AND stl.transfer_id = ?
       ORDER BY stl.created_at ASC`,
      [row.from_branch, tenantId, transferId],
    );

    const lines: StockTransferLine[] = lineRows.map((l) => ({
      id: l.id,
      transferId: l.transferId ?? l.transfer_id,
      itemId: l.itemId ?? l.item_id,
      itemName: l.itemName ?? l.item_name,
      itemSku: l.itemSku ?? l.item_sku,
      itemBarcode: l.itemBarcode ?? l.item_barcode,
      qtyMilli: Number(l.qtyMilli ?? l.qty_milli ?? 0),
      receivedQtyMilli: Number(l.receivedQtyMilli ?? l.received_qty_milli ?? 0),
      discrepancyMilli: Number(l.discrepancyMilli ?? l.discrepancy_milli ?? 0),
      discrepancyReason: l.discrepancyReason ?? l.discrepancy_reason ?? null,
      unit: l.unit || 'pcs',
      batchNo: l.batchNo ?? l.batch_no ?? null,
      expiry: l.expiry ?? null,
      availableStockMilli: Number(l.availableStockMilli ?? l.available_stock_milli ?? 0),
    }));

    // Fetch associated stock movements for both source and destination branches
    const moves = await ctx.db.query<any>(
      `SELECT 
        sm.id, sm.seq, sm.item_id, sm.location, sm.qty_milli, sm.kind,
        sm.ref_type, sm.ref_id, sm.ref_line_id, sm.batch_no, sm.expiry,
        sm.reason, sm.notes, sm.created_at,
        i.name AS item_name, i.sku AS item_sku, i.barcode AS item_barcode, i.unit AS item_unit
       FROM stock_moves sm
       JOIN items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id
       WHERE sm.tenant_id = ? AND sm.ref_type = 'stock_transfer' AND sm.ref_id = ?
       ORDER BY sm.seq ASC`,
      [tenantId, transferId],
    );

    const sourceMoves: StockMove[] = [];
    const destinationMoves: StockMove[] = [];

    for (const m of moves) {
      const formatted: StockMove = {
        id: m.id,
        seq: Number(m.seq),
        itemId: m.itemId ?? m.item_id,
        itemName: m.itemName ?? m.item_name,
        sku: m.sku ?? m.item_sku,
        barcode: m.barcode ?? m.item_barcode,
        unit: m.unit ?? m.item_unit ?? 'pcs',
        location: m.location,
        qtyMilli: Number(m.qtyMilli ?? m.qty_milli),
        kind: m.kind,
        refType: m.refType ?? m.ref_type,
        refId: m.refId ?? m.ref_id,
        refLineId: m.refLineId ?? m.ref_line_id,
        refNumber: row.transfer_number,
        batchNo: m.batchNo ?? m.batch_no,
        expiry: m.expiry,
        reason: m.reason,
        notes: m.notes,
        createdAt: m.createdAt ?? m.created_at,
      };

      if (m.location === row.from_branch) {
        sourceMoves.push(formatted);
      } else {
        destinationMoves.push(formatted);
      }
    }

    // Activity log from audit_log
    const activityLog = await ctx.db.query<any>(
      `SELECT al.id, al.action, al.user_name, al.created_at, al.detail
       FROM audit_log al
       WHERE al.tenant_id = ? AND al.entity = 'stock_transfer' AND al.entity_id = ?
       ORDER BY al.created_at ASC`,
      [tenantId, transferId],
    );

    const transfer: StockTransfer = {
      id: row.id,
      tenantId: row.tenantId ?? row.tenant_id,
      transferNumber: row.transferNumber ?? row.transfer_number,
      fromBranch: row.fromBranch ?? row.from_branch,
      fromBranchName: row.fromBranchName ?? row.from_branch_name ?? row.fromBranch ?? row.from_branch,
      toBranch: row.toBranch ?? row.to_branch,
      toBranchName: row.toBranchName ?? row.to_branch_name ?? row.toBranch ?? row.to_branch,
      status: (row.status as StockTransferStatus),
      transferDate: row.transferDate ? String(row.transferDate).split('T')[0] : String(row.transfer_date).split('T')[0],
      requestedBy: row.requestedBy ?? row.requested_by,
      requestedByName: row.requestedByName ?? row.requested_by_name ?? 'Staff User',
      approvedBy: row.approvedBy ?? row.approved_by,
      approvedByName: row.approvedByName ?? row.approved_by_name,
      approvedAt: row.approvedAt ?? row.approved_at,
      dispatchedBy: row.dispatchedBy ?? row.dispatched_by,
      dispatchedByName: row.dispatchedByName ?? row.dispatched_by_name,
      dispatchedAt: row.dispatchedAt ?? row.dispatched_at,
      receivedBy: row.receivedBy ?? row.received_by,
      receivedByName: row.receivedByName ?? row.received_by_name,
      receivedAt: row.receivedAt ?? row.received_at,
      notes: row.notes || null,
      itemsCount: lines.length,
      lines,
      stockMoves: {
        source: sourceMoves,
        destination: destinationMoves,
      },
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    };

    return {
      transfer,
      lines,
      stockMoves: {
        source: sourceMoves,
        destination: destinationMoves,
      },
      activityLog,
    };
  });

  // 5. Create a new Stock Transfer
  r.post('/api/stock-transfers', requirePerm('stock.transfer'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const body = ctx.body ?? {};

    const fromBranch = V.str(body.fromBranch, 'Source Branch (From Branch)', { min: 1 }).trim().toUpperCase();
    const toBranch = V.str(body.toBranch, 'Destination Branch (To Branch)', { min: 1 }).trim().toUpperCase();
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
    const transferDate = (body.transferDate ? String(body.transferDate).split('T')[0] : new Date().toISOString().split('T')[0]);
    const rawLines = Array.isArray(body.lines) ? body.lines : [];

    if (fromBranch === toBranch) {
      throw bad('Source branch and Destination branch cannot be the same. Please select different branches.');
    }

    if (rawLines.length === 0) {
      throw bad('Please add at least one product to the stock transfer.');
    }

    // Role verification for branch
    if (ctx.user!.role === 'manager') {
      const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
      if (!allowed.includes(fromBranch)) {
        throw forbidden(`You do not have permission to transfer stock out of branch ${fromBranch}.`);
      }
    }

    // Validate that both branches exist for this tenant
    const branches = await ctx.db.query<any>(
      `SELECT code, name FROM branches WHERE tenant_id = ? AND code IN (?, ?)`,
      [tenantId, fromBranch, toBranch],
    );
    const validCodes = new Set(branches.map((b) => b.code.toUpperCase()));
    if (!validCodes.has(fromBranch)) {
      throw bad(`Source branch "${fromBranch}" does not exist in your store.`);
    }
    if (!validCodes.has(toBranch)) {
      throw bad(`Destination branch "${toBranch}" does not exist in your store.`);
    }

    // Execute creation in a transaction
    return await ctx.db.tx(async (q) => {
      // 1. Atomically generate sequence transfer number: TRF-0001
      const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'TRF', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      const transferNumber = `TRF-${String(seqNo).padStart(4, '0')}`;

      // 2. Insert stock_transfers header
      const transferId = newId('trf');
      await q.exec(
        `INSERT INTO stock_transfers (
          id, tenant_id, transfer_number, from_branch, to_branch, status, transfer_date, requested_by, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, now(), now())`,
        [transferId, tenantId, transferNumber, fromBranch, toBranch, transferDate, ctx.user!.id, notes],
      );

      // 3. Validate products & available stock, then insert stock_transfer_lines
      const seenItems = new Set<string>();
      for (const item of rawLines) {
        const itemId = V.str(item.itemId ?? item.id, 'Product ID');
        if (seenItems.has(itemId)) {
          throw bad(`Duplicate product in transfer list. Please consolidate quantities into one row.`);
        }
        seenItems.add(itemId);

        const rawQty = item.qty ?? item.quantity ?? (item.qtyMilli ? item.qtyMilli / 1000 : 0);
        const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw bad('Quantity must be greater than zero.', 'VALIDATION', { field: 'quantity' });
        }
        const qtyMilli = Math.round(qty * 1000);

        // Verify item exists
        const itemRow = await q.one<any>(
          `SELECT id, name, unit, track_stock, track_batch FROM items WHERE tenant_id = ? AND id = ? AND active = true`,
          [tenantId, itemId],
        );
        if (!itemRow) {
          throw bad(`Product with ID ${itemId} was not found or is inactive.`);
        }

        // Available stock check at fromBranch
        const stockRow = await q.one<{ stockMilli?: number; stock_milli?: number }>(
          `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS stock_milli
           FROM stock_moves
           WHERE tenant_id = ? AND item_id = ? AND location = ?`,
          [tenantId, itemId, fromBranch],
        );
        const availableStockMilli = Number(stockRow?.stockMilli ?? stockRow?.stock_milli ?? 0);

        if (availableStockMilli < qtyMilli) {
          throw bad(
            `Insufficient stock for "${itemRow.name}" at source branch ${fromBranch}. Available: ${(availableStockMilli / 1000).toLocaleString('en-IN')}, Requested: ${qty.toLocaleString('en-IN')}`,
          );
        }

        const lineId = newId('trfl');
        await q.exec(
          `INSERT INTO stock_transfer_lines (
            id, tenant_id, transfer_id, item_id, qty_milli, received_qty_milli, discrepancy_milli, unit, batch_no, expiry, created_at
          ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, now())`,
          [lineId, tenantId, transferId, itemId, qtyMilli, item.unit || itemRow.unit || 'pcs', item.batchNo || null, item.expiry || null],
        );
      }

      await audit(q, ctx, {
        action: 'stock_transfer.create',
        entity: 'stock_transfer',
        entityId: transferId,
        detail: {
          transferNumber,
          fromBranch,
          toBranch,
          itemsCount: rawLines.length,
          transferDate,
        },
      });

      return {
        success: true,
        transferId,
        transferNumber,
        message: `Stock transfer ${transferNumber} created successfully.`,
      };
    });
  });

  // 6. Dispatch stock transfer (reduces available stock at source branch and marks in_transit)
  r.post('/api/stock-transfers/:id/dispatch', requirePerm('stock.transfer'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const transferId = ctx.params.id;

    return await ctx.db.tx(async (q) => {
      // 1. Lock transfer row
      const st = await q.one<any>(
        `SELECT * FROM stock_transfers WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [tenantId, transferId],
      );
      if (!st) throw notFound('Stock transfer not found.');

      if (st.status === 'in_transit') {
        throw conflict('This stock transfer is already in transit.', 'ALREADY_DISPATCHED');
      }
      if (st.status === 'completed' || st.status === 'received' || st.status === 'partially_received') {
        throw bad('Cannot dispatch a transfer that is already received or completed.');
      }
      if (st.status === 'cancelled' || st.status === 'rejected') {
        throw bad('Cannot dispatch a cancelled or rejected transfer.');
      }

      const fromBranch = st.fromBranch ?? st.from_branch;
      const toBranch = st.toBranch ?? st.to_branch;
      const transferNumber = st.transferNumber ?? st.transfer_number;

      // Check user permissions for source branch
      if (ctx.user!.role === 'manager') {
        const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
        if (!allowed.includes(fromBranch)) {
          throw forbidden(`You do not have dispatch authority for source branch ${fromBranch}.`);
        }
      }

      // 2. Fetch lines
      const lines = await q.query<any>(
        `SELECT stl.*, i.name AS item_name
         FROM stock_transfer_lines stl
         JOIN items i ON i.id = stl.item_id AND i.tenant_id = stl.tenant_id
         WHERE stl.tenant_id = ? AND stl.transfer_id = ?`,
        [tenantId, transferId],
      );
      if (lines.length === 0) throw bad('Transfer has no line items.');

      // 3. Re-verify source branch stock with row-level safety
      for (const line of lines) {
        const lineItemId = line.itemId ?? line.item_id;
        const lineItemName = line.itemName ?? line.item_name;
        const lineBatchNo = line.batchNo ?? line.batch_no ?? null;
        const lineExpiry = line.expiry ?? null;

        const stockRow = await q.one<{ stockMilli?: number; stock_milli?: number }>(
          `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS stock_milli
           FROM stock_moves
           WHERE tenant_id = ? AND item_id = ? AND location = ?`,
          [tenantId, lineItemId, fromBranch],
        );
        const available = Number(stockRow?.stockMilli ?? stockRow?.stock_milli ?? 0);
        const required = Number(line.qtyMilli ?? line.qty_milli);

        if (available < required) {
          throw bad(
            `Cannot dispatch: stock for "${lineItemName}" dropped below transfer quantity at ${fromBranch}. Available: ${available / 1000}, Required: ${required / 1000}`,
          );
        }

        // Append negative stock movement at source branch
        const moveId = newId('sm');
        await q.exec(
          `INSERT INTO stock_moves (
            id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, batch_no, expiry, reason, notes, user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, 'transfer', 'stock_transfer', ?, ?, ?, ?, 'Stock transfer dispatch out', ?, ?, now())`,
          [
            moveId,
            tenantId,
            lineItemId,
            fromBranch,
            -required, // Negative movement at source branch
            transferId,
            line.id,
            lineBatchNo,
            lineExpiry,
            `Transferred to ${toBranch} (${transferNumber})`,
            ctx.user!.id,
          ],
        );
      }

      // 4. Update transfer status
      await q.exec(
        `UPDATE stock_transfers
         SET status = 'in_transit',
             dispatched_by = ?,
             dispatched_at = now(),
             updated_at = now()
         WHERE id = ?`,
        [ctx.user!.id, transferId],
      );

      await audit(q, ctx, {
        action: 'stock_transfer.dispatch',
        entity: 'stock_transfer',
        entityId: transferId,
        detail: {
          transferNumber,
          fromBranch,
          toBranch,
          dispatchedItems: lines.length,
        },
      });

      return {
        success: true,
        status: 'in_transit',
        message: `Transfer ${transferNumber} dispatched. Stock successfully deducted from ${fromBranch} and marked in transit.`,
      };
    });
  });

  // 7. Receive stock transfer at destination branch (supports full and partial receipt with discrepancy tracking)
  r.post('/api/stock-transfers/:id/receive', requirePerm('stock.transfer'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const transferId = ctx.params.id;
    const body = ctx.body ?? {};
    const itemReceipts: any[] = Array.isArray(body.lines) ? body.lines : [];

    return await ctx.db.tx(async (q) => {
      // 1. Lock transfer row
      const st = await q.one<any>(
        `SELECT * FROM stock_transfers WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [tenantId, transferId],
      );
      if (!st) throw notFound('Stock transfer not found.');

      if (st.status !== 'in_transit' && st.status !== 'partially_received') {
        throw bad(`Cannot receive transfer in "${st.status}" status. Only in-transit or partially received transfers can be received.`);
      }

      const fromBranch = st.fromBranch ?? st.from_branch;
      const toBranch = st.toBranch ?? st.to_branch;
      const transferNumber = st.transferNumber ?? st.transfer_number;

      // Check destination branch permission
      if (ctx.user!.role === 'manager') {
        const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
        if (!allowed.includes(toBranch)) {
          throw forbidden(`You do not have receiving authority for destination branch ${toBranch}.`);
        }
      }

      // 2. Fetch existing lines
      const lines = await q.query<any>(
        `SELECT stl.*, i.name AS item_name
         FROM stock_transfer_lines stl
         JOIN items i ON i.id = stl.item_id AND i.tenant_id = stl.tenant_id
         WHERE stl.tenant_id = ? AND stl.transfer_id = ?`,
        [tenantId, transferId],
      );

      let hasDiscrepancy = false;
      const receiptMap = new Map<string, { receivedQtyMilli: number; discrepancyReason?: string }>();

      for (const rItem of itemReceipts) {
        const lineId = rItem.lineId ?? rItem.id;
        if (lineId) {
          const recQty = rItem.receivedQty !== undefined
            ? Math.round(Number(rItem.receivedQty) * 1000)
            : (rItem.receivedQtyMilli !== undefined ? Number(rItem.receivedQtyMilli) : undefined);
          receiptMap.set(lineId, {
            receivedQtyMilli: recQty ?? 0,
            discrepancyReason: rItem.discrepancyReason ? String(rItem.discrepancyReason).trim() : undefined,
          });
        }
      }

      for (const line of lines) {
        const lineItemId = line.itemId ?? line.item_id;
        const lineItemName = line.itemName ?? line.item_name;
        const lineBatchNo = line.batchNo ?? line.batch_no ?? null;
        const lineExpiry = line.expiry ?? null;
        const lineDispatchedMilli = Number(line.qtyMilli ?? line.qty_milli);
        const previouslyReceivedMilli = Number(line.receivedQtyMilli ?? line.received_qty_milli ?? 0);

        // If specific line receipt was passed in request, use it; otherwise default to full receipt
        let newReceivedMilli: number;
        let lineReason = line.discrepancyReason ?? line.discrepancy_reason ?? null;

        if (receiptMap.has(line.id)) {
          const entry = receiptMap.get(line.id)!;
          newReceivedMilli = entry.receivedQtyMilli;
          if (entry.discrepancyReason) lineReason = entry.discrepancyReason;
        } else {
          // Default: receive remaining dispatched quantity in full
          newReceivedMilli = lineDispatchedMilli;
        }

        if (newReceivedMilli < 0) {
          throw bad(`Received quantity cannot be negative for ${lineItemName}.`);
        }
        if (newReceivedMilli > lineDispatchedMilli) {
          throw bad(
            `Received quantity (${newReceivedMilli / 1000}) cannot exceed dispatched quantity (${lineDispatchedMilli / 1000}) for ${lineItemName}.`,
          );
        }

        const discrepancyMilli = lineDispatchedMilli - newReceivedMilli;
        if (discrepancyMilli > 0) {
          hasDiscrepancy = true;
          if (!lineReason) {
            throw bad(
              `Shortage discrepancy detected for "${lineItemName}" (${discrepancyMilli / 1000} ${line.unit} missing). A discrepancy reason is required.`,
            );
          }
        }

        // Calculate delta to add to destination branch
        const deltaToAddMilli = newReceivedMilli - previouslyReceivedMilli;

        if (deltaToAddMilli > 0) {
          // Append positive stock movement at destination branch
          const moveId = newId('sm');
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, batch_no, expiry, reason, notes, user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, 'transfer', 'stock_transfer', ?, ?, ?, ?, 'Stock transfer received in', ?, ?, now())`,
            [
              moveId,
              tenantId,
              lineItemId,
              toBranch,
              deltaToAddMilli, // Positive movement at destination branch
              transferId,
              line.id,
              lineBatchNo,
              lineExpiry,
              `Received from ${fromBranch} (${transferNumber})`,
              ctx.user!.id,
            ],
          );
        }

        // Update line record
        await q.exec(
          `UPDATE stock_transfer_lines
           SET received_qty_milli = ?,
               discrepancy_milli = ?,
               discrepancy_reason = ?
           WHERE id = ?`,
          [newReceivedMilli, discrepancyMilli, lineReason, line.id],
        );
      }

      const finalStatus: StockTransferStatus = hasDiscrepancy ? 'partially_received' : 'completed';

      await q.exec(
        `UPDATE stock_transfers
         SET status = ?,
             received_by = ?,
             received_at = now(),
             updated_at = now()
         WHERE id = ?`,
        [finalStatus, ctx.user!.id, transferId],
      );

      await audit(q, ctx, {
        action: 'stock_transfer.receive',
        entity: 'stock_transfer',
        entityId: transferId,
        detail: {
          transferNumber,
          fromBranch,
          toBranch,
          finalStatus,
          hasDiscrepancy,
        },
      });

      return {
        success: true,
        status: finalStatus,
        message: hasDiscrepancy
          ? `Transfer ${transferNumber} received with shortages recorded. Status updated to Partially Received.`
          : `Transfer ${transferNumber} received in full. Stock added to ${toBranch} and status marked Completed.`,
      };
    });
  });

  // 8. Cancel a stock transfer (if in-transit, reverses deducted stock back to source)
  r.post('/api/stock-transfers/:id/cancel', requirePerm('stock.transfer'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const transferId = ctx.params.id;
    const reason = typeof ctx.body?.reason === 'string' ? ctx.body.reason.trim() : 'Cancelled by user';

    return await ctx.db.tx(async (q) => {
      const st = await q.one<any>(
        `SELECT * FROM stock_transfers WHERE tenant_id = ? AND id = ? FOR UPDATE`,
        [tenantId, transferId],
      );
      if (!st) throw notFound('Stock transfer not found.');

      if (st.status === 'completed' || st.status === 'received') {
        throw bad('Cannot cancel a completed stock transfer.');
      }
      if (st.status === 'cancelled') {
        throw bad('Transfer is already cancelled.');
      }

      const fromBranch = st.fromBranch ?? st.from_branch;
      const transferNumber = st.transferNumber ?? st.transfer_number;

      // If it was in transit, restore deducted stock to source branch
      if (st.status === 'in_transit') {
        const lines = await q.query<any>(
          `SELECT * FROM stock_transfer_lines WHERE tenant_id = ? AND transfer_id = ?`,
          [tenantId, transferId],
        );

        for (const line of lines) {
          const lineItemId = line.itemId ?? line.item_id;
          const lineQtyMilli = Number(line.qtyMilli ?? line.qty_milli);
          const moveId = newId('sm');
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, reason, notes, user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, 'transfer', 'stock_transfer_reversal', ?, ?, 'Stock transfer cancellation reversal', ?, ?, now())`,
            [
              moveId,
              tenantId,
              lineItemId,
              fromBranch,
              lineQtyMilli, // Re-credit source branch
              transferId,
              line.id,
              `Reversal due to cancellation of ${transferNumber}`,
              ctx.user!.id,
            ],
          );
        }
      }

      await q.exec(
        `UPDATE stock_transfers
         SET status = 'cancelled',
             notes = COALESCE(notes || ' | ', '') || 'Cancelled: ' || ?,
             updated_at = now()
         WHERE id = ?`,
        [reason, transferId],
      );

      await audit(q, ctx, {
        action: 'stock_transfer.cancel',
        entity: 'stock_transfer',
        entityId: transferId,
        detail: {
          transferNumber,
          previousStatus: st.status,
          reason,
        },
      });

      return {
        success: true,
        status: 'cancelled',
        message: `Stock transfer ${transferNumber} cancelled successfully.`,
      };
    });
  });
}
