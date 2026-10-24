# Purchase and Stock Inward Spec

**Billing Platform — Feature Specification**
Supplier purchase entry + stock inward + supplier payable (khata) + GST Input Tax Credit

> This document tells the build team exactly what to build, where each element goes, what happens on every click, and how to test it. A developer can implement the feature without a follow-up meeting, and a tester can verify it line by line.
>
> **For AI builders (Antigravity / coding agents):** Read this entire file first, then implement it exactly as written. Follow the build order in Section 13, run the test checklist in Section 14, and report the files you changed and the test results. Do not change the GST engine's tax calculation rules or the invoice numbering logic — reuse them in the purchase direction. A purchase is **not** a sale in reverse by editing stock counts directly. Every unit that enters stock must have a purchase document behind it, just as every unit that left stock had a sales bill behind it (and every unit that came back had a credit note behind it, Step 3).

| Item | Detail |
| --- | --- |
| Feature | Purchase & Stock Inward — Step 4 of the daily-loop roadmap |
| Priority | P0 — build after Step 1 (WhatsApp Bill Sharing), Step 2 (Khata Payment Collection), and Step 3 (Returns & Credit Notes), before shifts / Z-report and camera scan |
| Surfaces | Purchases list (new) + Create Purchase screen (new) + Purchase success modal (new) + Suppliers list & supplier detail / ledger (extend existing Parties) + Products / Stock view (stock history) |
| Already built | Parties master with `type: supplier`, GST engine (CGST + SGST / IGST, inclusive / exclusive, round-off), Number Series Engine, stock deduction at sale and stock return-in at Step 3, `stock_moves` table, customer dues + FIFO allocation + Customer Advance (Step 2), credit notes (Step 3), receipt / document rendering (thermal 58mm / 80mm + A4), `shared/whatsapp.ts` with EN / HI / TA templates (Steps 1–3) |
| Depends on | Item / product master, supplier (party) master, GST engine, stock moves, Number Series Engine |
| Out of Phase 1 | Purchase returns / debit notes to suppliers, purchase orders & approvals, goods-received-vs-ordered three-way matching, barcode camera scan inward (Step 6), automatic supplier payment via bank / gateway |

> **How to read this spec:** Sections 1–3 are the decision record — what and why. Sections 4–10 are the build instructions — entry points, the purchase flow, money and GST (Input Tax Credit) maths, supplier payment, stock, and the purchase document. Section 11 is data, permissions, and corrections, Section 12 is edge cases, Section 13 is the build order, and Section 14 is the test checklist. Do not skip Section 6 (money & GST) or Section 8 (stock): a purchase with wrong ITC or wrong stock is worse than no purchase entry, because GSTR-2B reconciliation and inventory both stop being trusted.

## 1. Purpose — goods come in, and today the software only knows how they go out

Every shop on this platform buys before it sells. Goods arrive from a supplier with a supplier tax invoice, the boxes are opened and counted, and those units become the stock the POS sells from. The platform today handles the second half correctly — stock falls at sale, comes back on a restocked return — but it has no honest way to record the first half: where the stock came from.

Without this step, staff do the only things they can: type a new stock quantity directly into the product, keep the supplier's paper bill in a drawer, and remember the supplier balance in their head or a notebook. Every one of those workarounds breaks a record the platform has kept correct until now: stock has no document behind it, purchase cost is unknown so margin reports are fiction, GST Input Tax Credit (ITC) the shop is legally entitled to claim is never tracked, and the amount owed to the supplier — the shop's payable khata — exists nowhere in the system.

Purchase & Stock Inward close that gap the legally correct way:

- **One screen** to enter a supplier purchase: supplier, the supplier's own invoice number and date, and the lines exactly as billed by the supplier.
- **One new document:** a Purchase record with its own internal number (for example `PUR-1001`), permanently storing the supplier invoice number it came from — the supplier's invoice is never re-numbered or overwritten.
- **Three automatic effects, together or not at all:** stock rises by the received quantities, the supplier's payable balance rises by the unpaid part of the purchase, and GST Input Tax Credit is recorded for the purchase's period.
- **One clear payment record:** what was already paid to the supplier at delivery is recorded on the purchase; what remains is a payable the shop can settle later through the supplier payment flow in Section 7 — oldest purchase first, the mirror of Step 2.

Success looks like this: a delivery arrives from Sri Lakshmi Traders with their invoice SLT-2841 for ₹9,646 including GST. The manager opens Purchases, taps New Purchase, picks the supplier, types SLT-2841 and the date, adds 20 Cotton Shirts and 10 Detergent 1 kg at the supplier's rates, confirms ₹5,000 already paid by UPI, and saves. In under a minute PUR-1018 is recorded, stock shows +20 shirts and +10 detergent, the supplier ledger shows ₹4,646 still payable against SLT-2841, and Reports show ₹1,146 of ITC available for the month — with the supplier's paper invoice number searchable any time.

## 2. Current state — what exists and what is missing

| Piece | State | Source |
| --- | --- | --- |
| Parties master (customers and suppliers) | Built — `parties` with `type: customer / supplier`, GSTIN, phone | Existing Parties |
| GST engine | Built — intra-state CGST + SGST vs inter-state IGST, inclusive / exclusive, round-off reconciliation | Existing core |
| Number Series Engine | Built — collision-free numbering with a per-business prefix | Existing core |
| Stock deduction at sale | Built — inventory reduces on checkout | Existing POS + stock moves |
| Stock return-in on sales return | Built in Step 3 — restock moves linked to a credit note | Step 3 |
| Stock moves table | Built — `stock_moves` records stock changes with a linked document | Existing DB schema |
| Customer dues, FIFO allocation, ledger | Built in Step 2 — customer-side khata, payment allocations, running-balance ledger | Step 2 |
| Receipt / document rendering | Built — thermal 58mm / 80mm and full A4 GST documents | Existing rendering + `shared/bill.ts` |
| Product / item master | Built — items with selling price, GST rate, stock quantity | Existing Products |
| Purchase entry screen and Purchases list | Missing — no way to record a supplier bill | To build (Sections 4–5) |
| Stock inward from a purchase document | Missing — stock only moves out at sale and back at return today | To build (Section 8) |
| Supplier payable balance and supplier ledger | Missing — supplier khata does not exist; only customer khata was built in Step 2 | To build (Sections 7, 10) |
| Supplier payment (paying a supplier against purchases) | Missing | To build (Section 7) |
| GST Input Tax Credit tracking from purchases | Missing — GST reports today only track output tax on sales and its reversal on credit notes | To build (Sections 6, 10) |
| Purchase cost history per item (last purchase price) | Missing | To build (Sections 6.5, 11.1) |

Nothing in this feature requires changing how a sale is created, how GST is calculated on a sale, how khata payments from customers are recorded, or how credit notes work. The purchase direction reuses the same engines with the opposite stock and tax direction. If implementation appears to need a change to a sales flow, stop — that is a scope error, not a requirement.

## 3. Scope

### In scope — Phase 1

- Purchases list: every recorded purchase with supplier, supplier invoice number, date, total, amount paid, balance payable, and status.
- Create Purchase screen: supplier selection (with inline supplier creation), supplier invoice number and date (required), per-line item, quantity received, purchase rate, discount, and GST — exactly as on the supplier's bill.
- New item inline: if a purchased item does not exist in the product master, the cashier / manager can create it from inside the purchase screen (name, unit, GST rate, selling price / MRP) without losing the purchase being entered.
- Batch / expiry capture per line where the item is batch-tracked (pharmacy / food): batch number, expiry date, MRP — stock enters against that batch.
- Stock inward: on save, each line's received quantity enters stock with a stock move linked to the purchase (Section 8).
- Money and GST: purchase totals computed with the existing GST engine; GST on purchases recorded as Input Tax Credit, never as output tax (Section 6), with a worked example that must match exactly.
- Payment at purchase: amount already paid to the supplier (full, part, or none) with mode and reference, recorded on the purchase; the remainder becomes supplier payable.
- Pay Supplier flow after purchase: record a later payment against a supplier, allocated oldest-purchase-first (FIFO) across their open purchases — the mirror of Step 2's Collect Payment (Section 7).
- Supplier ledger: chronological purchases (money owed), supplier payments (money paid), and a running payable balance — the mirror of the Step 2 customer ledger (Section 10).
- Purchase document view and print (A4 + thermal summary): the shop's own record of the purchase, always showing the supplier invoice number.
- Voiding a purchase (Owner / Manager only, with a reason) as a full reversal of its stock, payable, and ITC effects — never a silent delete or edit (Section 11.3).

### Out of scope — do not build in Phase 1

- **Editing stock quantity directly to "add" purchased goods.** Never the path. If goods came in, they came in on a purchase. A direct stock-quantity edit with no document is exactly the workaround this feature replaces. (A separate stock-adjustment / stock-audit flow for damage, theft, and counting corrections is a later feature with its own reason codes — do not smuggle it into this screen.)
- **Purchase returns and debit notes (sending goods back to a supplier).** That is the mirror of Step 3 on the purchase side and gets its own later spec. In Phase 1, a wrong purchase is corrected by void-and-re-enter (Section 11.3); goods physically sent back after that are tracked outside the system until the debit-note step ships.
- **Purchase orders, quotations, and approval workflows.** Phase 1 records a purchase that has already happened (goods + supplier bill in hand). Raising a PO, sending it to a supplier, and matching delivery against it is a later procurement step.
- **Supplier payments through a bank / payment gateway.** "Paid" in Phase 1 records a payment the shop physically made (cash handed over, or a UPI / bank transfer staff sent from the shop's own account). The platform does not move money itself and must never claim it did.
- **Automatic selling-price recalculation.** A purchase may show the item's current selling price and margin at the purchase cost (Section 6.5) and may let the user update the selling price explicitly, but saving a purchase never silently changes a selling price.
- **Multi-godown / multi-location stock.** Stock is one location per business in Phase 1, as it is for sales today. Location transfers are a later inventory step.
- **Import purchases, foreign currency, and customs duty.** Phase 1 is domestic INR purchases under GST only. A supplier with no GSTIN is handled (Section 6.4); a foreign supplier is not.

## 4. Entry points — Purchases, Suppliers, and Products

### 4.1 The Purchases list (new page)

- **Navigation:** a top-level "Purchases" item in the sidebar, placed next to Invoices — purchases and sales are the two document lists of the business.
- **New Purchase button:** primary action, top-right of the page. Opens the Create Purchase screen (Section 5).
- **Columns per row:** internal purchase number (`PUR-…`), purchase date, supplier name, supplier invoice number, total amount, amount paid, balance payable, status (Paid / Part-Paid / Unpaid / Voided).
- **Filters:** by supplier, by date range, and by status, using the filter behaviour the Invoices list already has. Search by supplier invoice number and by internal purchase number — the owner holding a supplier's paper bill searches by *their* number, not ours.
- **Row actions:** View (opens the purchase detail, Section 4.3), Print, Pay Supplier (only when a balance payable remains — opens Section 7 with this purchase in view), Void (Owner / Manager only, Section 11.3).
- **Voided rows** stay visible, badged "Voided", with no Pay action. History is never hidden.

### 4.2 Suppliers — inside the existing Parties area

Suppliers already live in Parties with `type: supplier`. This step extends their views; it does not create a second supplier master.

- **Supplier row gains a payable balance:** total still owed to that supplier across all open purchases (for example "Payable ₹4,646 • oldest due 22 Oct"), or "No dues" when nothing is owed. This is the mirror of the customer balance column from Step 2.
- **Pay Supplier button:** on every supplier row whose payable balance is above ₹0, in the row's action area, labelled "Pay Supplier". Opens the Section 7 modal with that supplier pre-filled.
- **New Purchase for this supplier:** a secondary action on the supplier row / detail that opens the Create Purchase screen with that supplier pre-selected.

### 4.3 Purchase detail view

Clicking a purchase opens its detail view, containing:

| Zone | Content |
| --- | --- |
| Header | Internal purchase number, purchase date, supplier name / phone / GSTIN, supplier invoice number and its date, status |
| Lines | Per line: item, batch / expiry where tracked, quantity received, purchase rate, discount, taxable value, GST, line total |
| Totals | Taxable total, CGST + SGST or IGST (this is the ITC amount, labelled as such), other charges if any, round-off, purchase total |
| Payments | Every payment recorded against this purchase: date, amount, mode, reference, recorded-by — including the payment recorded at purchase time |
| Stock | Confirmation per line that stock was received ("+20 to stock • Batch B-114"), linking to the stock history |
| Actions | Print • Pay Supplier (when a balance remains) • Void (Owner / Manager only) |

### 4.4 Products / stock view touchpoint

The existing Products / stock view gains no new screen in this step, only two honest additions: the stock quantity now reflects purchase inward moves, and the stock history for an item shows purchase-in moves with their `PUR-…` number, visually distinct from sale-out moves and return-in moves (Step 3, Section 8.4). The item row also shows **Last purchase price** (Section 6.5) once any purchase exists for it.

### 4.5 Who can start a purchase — and who cannot

Cost prices and supplier dues are the owner's sensitive numbers. Unlike billing and khata collection, purchase entry is **not** an every-role action (full table in Section 11.2): Owner, Manager, and Accountant can create a purchase; a Cashier cannot open the Create Purchase screen and does not see purchase rates in the purchase detail. A Cashier can still sell the stock once it is in — they just never needed the cost to do it.

## 5. The Create Purchase screen — exact behaviour

### 5.1 Opening and closing

- **Trigger:** New Purchase in the Purchases list (4.1), or New Purchase from a supplier row / detail (4.2, supplier pre-selected). This is a full screen, not a small modal — a supplier bill routinely has ten or more lines.
- **Dismissal:** Back / Cancel — with no purchase created, no stock moved, no payable changed. If any line or header field has been entered, dismissing asks for one confirmation ("Discard this purchase entry?") so an accidental close does not silently lose typed work.
- **One purchase per save:** one save creates exactly one purchase record for the supplier bill entered in that save. A second supplier bill — even from the same supplier on the same day — is a second purchase, not extra lines added to the first.

### 5.2 Layout — top to bottom

| Zone | Content |
| --- | --- |
| Header | "New Purchase" + internal number preview (assigned on save) |
| Supplier zone | Supplier selector (search by name / phone), supplier GSTIN shown when present, "＋ New Supplier" inline creation (name, phone, GSTIN optional, address optional) |
| Supplier bill zone | **Supplier invoice number (required)** + **supplier invoice date (required)** + purchase date (defaults to today — the date the shop records / receives it; see 5.4) |
| Lines table | Section 5.3 — one row per line on the supplier's bill |
| Other charges zone | Optional: transport / freight / loading charges with amount and whether GST applies (Section 6.3) |
| Totals zone | Section 6.6 — taxable, GST (labelled Input Tax Credit), other charges, round-off, purchase total, always visible and live |
| Payment zone | Section 7.1 — amount paid now, mode, reference; balance payable computed live |
| Footer | "Save Purchase & Receive Stock" (primary) • Cancel |

### 5.3 Lines table — per-line purchase entry

One row per line on the supplier's bill. Columns, left to right:

| Column | Behaviour |
| --- | --- |
| Item | Search / select from the product master by name, SKU, or barcode. "＋ New Item" creates the item inline (name, unit, GST rate, selling price / MRP, opening stock is **not** asked — stock comes from this purchase's quantity) and returns to this row with it selected |
| Batch / Expiry | Shown only for batch-tracked items: batch number (text), expiry date, MRP for that batch. Required for batch-tracked items before Save is enabled |
| **Qty received (input)** | Numeric. The quantity physically received and counted. This quantity drives everything on save — stock, money, and ITC all follow it (see the billed-vs-received rule after this table) |
| Billed qty (input) | Numeric, defaults to equal to Qty received. Editable when they differ (short supply / damaged in transit) — the billed quantity is kept on the record so the shortfall against the supplier's bill is visible, even though the purchase is recorded on the received quantity |
| **Purchase rate (input)** | Unit price from the supplier's bill, before GST unless the supplier bills tax-inclusive — the line's tax treatment follows the supplier bill and the GST engine's inclusive / exclusive handling (Section 6.1) |
| Discount | Optional per line: amount or percentage, exactly as the supplier's bill shows it |
| GST rate | Pre-filled from the item master; editable per line to match the supplier's bill (the supplier's bill is the truth for ITC — Section 6.2) |
| Line total | Taxable + GST for the received quantity on that line, computed live (Section 6) — read-only |
| Selling price check | Read-only display of the item's current selling price and the margin at this purchase rate (Section 6.5). Display only — never an input that silently reprices the item |

Add-line and remove-line controls sit below the table. Removing a line asks for no confirmation (nothing has saved yet) but is undone by re-adding the item.

**Billed vs received rule (short supply):** the fixed rule, which must not be improvised: **money and ITC follow the quantity the shop accepts liability for, which in Phase 1 is the received quantity, at the rate and GST as billed.** The purchase total and ITC are never computed on a billed quantity larger than what arrived. If the supplier billed 10 and 9 arrived, the user enters Billed 10 / Received 9, and the purchase is recorded for 9 at the billed rate — the missing unit is not paid for and not claimed as ITC until a corrected / supplementary supplier bill arrives, at which point it is entered as its own purchase. The screen shows a plain note on any line where the two quantities differ: "Billed 10, received 9 — this purchase records 9. Record the balance when the supplier bills it." Phase 1 has no pending-receipt tracker; the note and the supplier's paper bill are the record.

### 5.4 Validation — inline, before Save is enabled

| Input | Rule | Message / behaviour |
| --- | --- | --- |
| No supplier selected | Invalid | "Select a supplier" in the supplier zone; Save stays disabled |
| Supplier invoice number empty | Invalid | "Enter the supplier's invoice number" — this is the document's identity for ITC and for the supplier's own records; a purchase without it cannot save |
| Same supplier + same supplier invoice number already recorded (non-voided) | Invalid — duplicate | "Invoice {number} from this supplier is already recorded as {PUR-…} on {date}." Save stays disabled. This single check prevents the most expensive purchase mistake: entering one supplier bill twice and doubling both stock and payable |
| Supplier invoice date missing, or in the future | Invalid | "Enter the supplier invoice date" / "Supplier invoice date cannot be in the future" |
| Purchase (recording) date before the supplier invoice date | Invalid | "Purchase date cannot be before the supplier invoice date" |
| No lines, or every line quantity is 0 | Invalid | "Add at least one item with a quantity" — Save stays disabled |
| Any line: qty negative, rate negative, or precision beyond the item's unit | Invalid | Inline hint on that row; Save stays disabled |
| Batch-tracked line with no batch number or no expiry | Invalid | "Batch and expiry are required for this item" on that row |
| Amount paid now is negative, or greater than the purchase total | Invalid | "Paid amount cannot exceed the purchase total of ₹{total}" in the payment zone |
| Amount paid now above ₹0 with no payment mode | Invalid | Mode group shows a hint; Save stays disabled |

All validation is inline, on the row or zone it belongs to. No alert popups, no page reload, and no purchase is created for a failed validation.

### 5.5 Saving — one atomic update

On Save Purchase & Receive Stock, the following happen together, or none of them happen:

1. A purchase record is created (Section 11.1) with its own internal number from the Number Series Engine (a purchase series, for example prefix `PUR-`, separate from the invoice, receipt, and credit-note series), storing the supplier invoice number and date exactly as entered.
2. For each line, a stock move brings the **received** quantity into stock, linked to the purchase (and to the line's batch, where batch-tracked).
3. The supplier's payable balance increases by the purchase total minus the amount paid now (Section 7.1), through a payable allocation recorded against this purchase.
4. If an amount paid now was entered, a supplier payment record is created for it, allocated in full to this purchase.
5. The success modal opens (Section 9.2).

If any part fails — network drop, server error — no part is saved: no purchase without its stock and payable effects, and no stock or payable change without a purchase. The screen stays open with the entered values intact and a plain error ("Purchase could not be saved. Check the connection and try again."), so the user can retry. A double-click on Save creates exactly one purchase (Section 12).

> **Rule that overrides everything in this section:** saving a purchase must never change any sales invoice, any credit note, or any customer balance. It changes only stock, the supplier's payable, and the purchase-side GST (ITC) figures. If an implementation needs to touch a sales record to make stock rise, it is the wrong implementation.

## 6. Money and GST rules — the purchase is the supplier's bill, recorded faithfully

A purchase's value is fully determined by the supplier's tax invoice: their rates, their discount, their GST rates, their tax treatment (intra-state vs inter-state, inclusive vs exclusive). This section fixes that maths so the manager, the owner, the supplier, and the CA filing GSTR all get the same number — and so the ITC the shop claims is exactly the GST the supplier charged, no more and no less.

### 6.1 Per-line purchase calculation

For each line:

1. **Start from the supplier bill's rate**, not from the item's last purchase price or selling price. Prices change between deliveries; a purchase always records what this bill actually charged.
2. **Quantity for money is the received / accepted quantity** (Section 5.3's billed-vs-received rule), at the billed rate. Taxable value for the line = rate × accepted quantity, minus that line's discount as shown on the supplier bill (amount discount directly; percentage discount computed on the line's gross, exactly as the GST engine handles a sales-line discount).
3. **Tax split follows the supplier bill:** a supplier inside the shop's state charges CGST + SGST; a supplier outside the state charges IGST. The screen derives this from the supplier's state vs the business's state (the same place-of-supply logic sales use), shows it on the line, and the totals zone (6.6) labels the whole purchase accordingly. A purchase never mixes CGST/SGST lines and IGST lines on one document — if the supplier's bill does, it is two different supplies and the user is told to record what the bill shows and flag it to their CA; Phase 1 follows the bill's majority treatment per document and stores the per-line tax components as entered, so reports stay reconcilable.
4. **Inclusive / exclusive follows the supplier bill:** if the supplier's rates are tax-inclusive, the line's taxable value is backed out with the same inclusive method the engine uses at sale; if exclusive, tax is calculated on the taxable value. The engine's existing logic is reused in the purchase direction — no second tax formula is written for purchases.
5. **Rounding:** each line's components are kept in paise (minor units) through the calculation, and the purchase's round-off line (6.6) reconciles the total exactly as invoices do, using the same round-off-to-nearest-rupee rule as the GST engine. Every report must read the stored purchase amounts — never a re-computation.

### 6.2 Input Tax Credit (ITC) — what it is in this system

- The GST charged on a purchase is **input tax**. It is not a cost the shop finally bears (when the supplier is GST-registered and the bill carries the shop's GSTIN) — it is a credit the shop sets off against the output GST it collects on sales. Reports therefore keep the two in separate buckets forever: **output GST** (sales, minus credit-note reversals) and **input GST / ITC** (purchases). They are never netted inside a single purchase or sales figure with no document trail; the netting the owner cares about — "GST payable this month" — is a Reports figure computed as output minus ITC for the period (Section 10.2).
- **ITC amount on a purchase = its total GST** (CGST + SGST, or IGST), stored on the purchase record as `itc_minor` alongside the split components.
- **When ITC is ₹0:** if the supplier has no GSTIN on record (an unregistered supplier), their bill charges no GST, every line's GST is 0, and the purchase records ITC ₹0. The screen shows a plain note: "This supplier has no GSTIN recorded — no GST / ITC on this purchase." The purchase still saves normally: stock and payable are real even when ITC is not.
- **ITC belongs to the purchase's period.** A supplier bill dated in October and recorded in October carries October ITC. A bill recorded late still carries its supplier invoice date, and reports place its ITC by the recording (purchase) date with the invoice date shown — the CA decides the filing treatment; the system's job is to never lose either date. Never back-date a purchase into a closed period silently: the purchase date defaults to today and Section 5.4's checks keep the two dates coherent.

### 6.3 Other charges (transport / freight / loading)

A supplier bill often carries a delivery charge. The Other Charges zone (5.2) takes: a label (default "Transport"), an amount, and a GST choice — **No GST** (default; the amount simply adds to the purchase total and to the payable) or a GST rate (its GST adds to the total and to ITC, computed by the same engine). Other charges never change any line's taxable value or stock. A purchase with no other charges shows no other-charges line anywhere — not a ₹0 line.

### 6.4 Discounts

Line discounts and any bill-level discount on the supplier's bill reduce the taxable value before GST, following the supplier bill and the engine's existing discount handling — the same principle Step 3 fixed for returns: the discount proportion lives inside the stored line amounts, so ITC is claimed on the discounted (actual) taxable value, never on the pre-discount MRP. If the supplier shows a bill-level discount, the screen takes it as one amount in the totals area and the backend apportions it across lines by taxable value, exactly as sales apportion a bill-level discount, so per-line ITC stays correct.

### 6.5 Purchase cost, last purchase price, and margin display

- On save, each purchased item's **Last purchase price** becomes this purchase's per-unit cost for that item (rate after line discount, before GST — GST is ITC, not cost, for a registered supplier; for an unregistered supplier the full rate is the cost since there is no GST split). This is a display and reporting field on the item, not a stock-valuation rewrite of units already in stock.
- The Create screen's selling-price check (5.3) shows, per line: current selling price, this purchase rate, and the resulting margin percentage — computed as (selling price − purchase cost) ÷ selling price, shown to one decimal. It is information at the moment of buying ("this delivery costs more than the last — margin is now 18%"), never an automatic price change (Section 3).
- Stock valuation in Reports (Section 10.2), where shown, values current stock at last purchase price and labels itself as such. Phase 1 does not implement FIFO / weighted-average valuation layers — do not invent one.

### 6.6 Worked example — test against this exact case

Purchase recorded 22 Oct 2026. Supplier: **Sri Lakshmi Traders** (GSTIN on record, same state as the shop — intra-state). Supplier invoice **SLT-2841**, dated 22 Oct 2026, prices tax-exclusive. No other charges, no bill-level discount.

| Line | Item | Qty (billed = received) | Rate (ex-tax) | Line discount | Taxable value | GST |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Cotton Shirt | 20 | ₹320 | ₹0 | ₹6,400 | 12% (CGST 6% + SGST 6%) |
| 2 | Detergent 1 kg | 10 | ₹210 | ₹0 | ₹2,100 | 18% (CGST 9% + SGST 9%) |

Purchase totals: taxable ₹8,500 • CGST ₹573 (₹384 + ₹189) • SGST ₹573 (₹384 + ₹189) • round-off ₹0 • **purchase total ₹9,646**. **ITC for this purchase: ₹1,146** (₹573 CGST + ₹573 SGST).

Payment at purchase (Section 7.1): **₹5,000 paid by UPI**. **Balance payable to the supplier after this save: ₹4,646**, allocated entirely against PUR-… (this purchase). Stock effect: **+20 Cotton Shirts**, **+10 Detergent 1 kg**. Last purchase prices after save: Shirt ₹320, Detergent ₹210.

Every number in Section 14's checklist that refers to "the worked example" means this table. If the implementation's numbers differ by even one paisa, the calculation is wrong — investigate the discount handling and the rounding before adjusting the example.

### 6.7 Totals zone — what the screen shows live

As lines are typed, the totals zone updates without any extra click:

- Taxable value (sum of lines)
- CGST and SGST (intra-state) **or** IGST (inter-state) — matching the supplier bill's treatment — under the heading **"GST (Input Tax Credit)"**, never under a sales-tax heading
- Other charges (only when entered, Section 6.3)
- Round-off (shown only when non-zero, exactly as invoices show it)
- **Purchase total** in bold — this is the amount that will be settled in Section 7 and printed on the purchase document

The user must be able to predict the saved purchase from this zone alone. The preview is computed by the same backend calculation that saves the purchase, never by a second, copied calculation in the frontend.

### 6.8 What a purchase is not

- **Not a stock edit.** Covered in Sections 3 and 5.5 — stated again here because it is the mistake this feature exists to prevent.
- **Not a sale with a negative sign.** A purchase creates no sales invoice, no output GST, and no customer dues. Reusing the invoice table / kind for storage is an implementation choice; reusing sales *reporting* for purchases is a defect.
- **Not a supplier payment.** Entering a purchase records what is owed; paying the supplier (at entry or later) records money out. Both touch the payable, but they are different records, different documents, and different report lines: purchases are never counted as payments, and a payment never creates stock or ITC.
- **Not a price-list update.** Section 6.5: last purchase price updates; selling prices do not, unless the user changes them explicitly in the product master.

## 7. Payment and supplier dues — the payable khata

A purchase usually creates a debt: the shop owes the supplier. That debt must live in exactly one place, fall only when money is actually paid, and be explainable purchase by purchase — the mirror image of the customer khata rules Step 2 fixed, with the direction reversed.

### 7.1 Payment at purchase time

The Create screen's payment zone takes:

| Field | Behaviour |
| --- | --- |
| Amount paid now | Numeric, defaults to ₹0 (full amount payable — the common trade-credit case). Quick chips: "Full ₹{total}" and "None" set the field; any part amount can be typed |
| Payment mode | Cash / UPI / Card / Bank — the same four modes as POS and Step 2. Required when amount paid now is above ₹0; Cash pre-selected |
| Reference (optional) | UPI transaction ID, bank reference, or cheque detail, as typed |
| Balance payable (read-only, live) | Purchase total − amount paid now. At ₹0 the purchase saves as Paid; above ₹0 it saves as Part-Paid / Unpaid and the amount joins the supplier's payable balance |

The payment recorded here is a real supplier payment record (Section 11.1) allocated entirely to this purchase — not a note in a text field — so the supplier ledger (Section 10.1) and payment reports treat money paid at delivery and money paid a week later identically.

### 7.2 Pay Supplier — paying later, oldest purchase first (FIFO)

- **Entry points:** the Pay Supplier button on a supplier row (4.2), on a purchase row / detail with a balance (4.1, 4.3), and inside the supplier detail view (Section 10.1). All open the identical modal with the supplier pre-filled — one modal, one code path, the Step 2 rule.
- **Modal fields:** supplier name and phone (header), total payable in bold with the count of open purchases, amount (pre-filled with the full payable, editable for a part payment), payment mode (required, Cash pre-selected), payment date (defaults to today; an earlier date is accepted for late recording; a future date is rejected with an inline hint), optional reference, optional internal note (never printed on any supplier-facing document), and an **allocation preview**.
- **Allocation preview — show the effect before saving:** which purchases the amount will settle, **oldest purchase first** (by supplier invoice date, then internal purchase number), and how much goes to each; the payable after this payment; and a clear "This clears the full payable" line when it does. The preview is computed by the same backend allocation code that saves the payment, never by a second frontend copy.
- **Validation:** amount empty / zero / negative is blocked ("Enter an amount above ₹0"); **amount greater than the total payable is blocked** — unlike a customer overpaying the shop (Step 2's Advance), the shop does not create a "supplier advance" in Phase 1. If a real advance to a supplier is needed, it is recorded outside this flow until a later spec covers it; the modal says so plainly: "Amount cannot exceed the payable of ₹{payable}. Advances to suppliers are not recorded here yet."
- **Saving is atomic** in the Step 2 sense: payment record + per-purchase allocations + each purchase's paid / balance / status update + the supplier's payable reduction happen together or not at all; a double-click creates exactly one payment (idempotency key, Section 11.1).

### 7.3 Worked allocation — test against this exact case

Supplier Sri Lakshmi Traders, payable ₹6,646 across two purchases:

| Purchase | Supplier invoice | Date | Purchase total | Already paid | Balance on purchase |
| --- | --- | --- | --- | --- | --- |
| PUR-1018 | SLT-2841 | 22 Oct 2026 | ₹9,646 | ₹5,000 | ₹4,646 |
| PUR-1021 | SLT-2902 | 25 Oct 2026 | ₹3,000 | ₹1,000 | ₹2,000 |

The shop pays **₹5,000 by Bank** on 28 Oct 2026. The allocation preview and the saved result must both be:

| Purchase | Receives | Balance after | Status after |
| --- | --- | --- | --- |
| PUR-1018 (oldest) | ₹4,646 | ₹0 | Paid |
| PUR-1021 | ₹354 | ₹1,646 | Part-Paid |

Supplier payable after payment: **₹1,646**. Payment total recorded: **₹5,000**, mode Bank.

### 7.4 What a supplier payment is not

- **Not a purchase.** It creates no stock, no ITC, and no new payable — it only reduces an existing one.
- **Not an expense entry.** Money paid to a supplier settles goods already recorded; it must not also be counted as a fresh expense / cost in reports, or the cost of goods is double-counted. Reports count the *purchase* as the cost event and the *payment* as a cash-out event (Section 10.2), on their own dates.
- **Not a discount.** A balance that disappears must disappear because money was paid (this section) or because the purchase was voided (Section 11.3). A negotiated supplier discount is recorded on the purchase itself (Section 6.4), never by quietly paying less and deleting the difference.

## 8. Stock rules — what enters the shelf, and on whose document

### 8.1 Inward moves

- Each saved purchase line creates one stock move of type purchase-in, quantity equal to the **received** quantity on that line, linked to the purchase and to the item (and batch, where batch-tracked).
- Stock increases at save time, inside the same atomic transaction as the purchase (Section 5.5). There is no separate "receive stock" step after saving a purchase — Save *is* the receiving.
- The stock move stores the line's purchase cost (Section 6.5) so stock history can show "20 in @ ₹320 • PUR-1018", which is how an owner later answers "where did this stock come from and what did it cost?"

### 8.2 Batch / expiry-tracked items

Where an item is batch-tracked, stock enters against the batch captured on the line (5.3): batch number, expiry, and that batch's MRP. The same item in two batches is two stock positions that share one item total — the POS batch behaviour already defined for sales applies unchanged; this step only guarantees the inward side always carries a batch. A batch-tracked line can never save without a batch (Section 5.4), so batch stock can never appear from nowhere.

### 8.3 Stock that a purchase must never create

- No stock for a line whose received quantity is 0 (billed but nothing arrived — Section 5.3).
- No stock from a voided purchase after its void (Section 11.3 reverses the inward moves).
- No stock change at all from recording a supplier *payment* (Section 7.4).
- No stock above what the purchase lines say: if the physical count and the purchase disagree, the purchase records the counted (received) quantity — the screen's job is to record reality, not the supplier's claim.

### 8.4 Stock reports and history

Stock history shows purchase-in moves with their purchase number, visually distinct from sale-out moves and return-in moves (Step 3). Current stock is one number the owner can trust because every movement — in at purchase, out at sale, back at return — now has a document behind it. That completeness is the point of this step: after Step 4 ships, there is no legitimate way for stock to change without a document.

## 9. The Purchase document and the success modal

A purchase document is the shop's own internal record of what was received against a supplier's bill. It is not a tax invoice (the supplier's invoice is the tax document) and must never look like one the shop issued for a sale.

### 9.1 Purchase document content — A4 and thermal summary

| Field | Source |
| --- | --- |
| Store name, address, GSTIN, phone | Business profile — as the *buyer* |
| "Purchase" heading | Fixed — with the internal purchase number; never headed "Tax Invoice" |
| Purchase number and recording date | Purchase record (number from the `PUR-` series) |
| Supplier name, address / phone, GSTIN (if present) | Supplier record |
| **Supplier invoice number and date** | Purchase record — always printed; this is the link to the legal tax document and to ITC |
| Lines | Per line: item, batch / expiry where tracked, billed qty, received qty, rate, discount, taxable value, GST rate and amount, line total |
| Tax summary | Total taxable, CGST + SGST or IGST — labelled "Input Tax Credit", round-off, each matching Section 6 |
| Other charges | Only when entered (Section 6.3), with its GST if any |
| **Purchase total** | In figures; A4 also shows it in words (reuse the Indian money-in-words helper added in Step 2) |
| Payment block | Plain words: amount paid (mode + reference if any) and balance payable — the three must sum to the purchase total |
| Recorded by | User who saved the purchase |

- Amounts use Indian number grouping and the ₹ symbol, formatted exactly as bills format them. The purchase total, the stock quantities, the payable effect, and the ITC in reports must be the same numbers to the paisa.
- Reprinting a purchase later prints the same document with the same internal number. A reprint never creates a new purchase number or a second stock / payable effect.
- A voided purchase reprints clearly marked "VOIDED" (Section 11.3).

### 9.2 Success modal — immediately after saving

- **Trigger:** the instant the purchase, stock moves, payable, and any at-purchase payment have saved successfully (Section 5.5). Never on a failed or partial save.
- **Header:** green tick + "Purchase recorded — stock received" + purchase number (for example PUR-1018).
- **Summary lines:** supplier name, purchase total in bold, stock received in one line (for example "Stock in: 3 items • 30 units"), and the money in one line — "Paid ₹5,000 (UPI) • Payable ₹4,646" or "Payable ₹9,646" when nothing was paid, or "Fully paid" when the balance is ₹0.
- **ITC line:** "Input Tax Credit (ITC) recorded: ₹1,146" — shown when ITC is above ₹0, so the owner sees the tax benefit land at the moment of buying. Hidden when ITC is ₹0 (unregistered supplier).
- **Actions:** Print Purchase • View A4 • New Purchase (starts a fresh entry — the delivery-van case, several supplier bills in a row).
- **Footer:** "Done" (primary, closes and returns to the Purchases list, refreshed, showing the new row) • Close (× in header).
- Dismissing the success modal never undoes the purchase. Correcting a wrong purchase is void-and-re-enter (Section 11.3), never an undo button here.

### 9.3 No WhatsApp purchase sharing in Phase 1

Unlike bills (Step 1), receipts (Step 2), and credit notes (Step 3), a purchase is an internal record between the shop and its own books — the supplier already has their invoice, which is the document of record between the two businesses. Phase 1 therefore builds **no** WhatsApp purchase message and no public purchase link. Do not copy the share flow onto this document "for consistency": a public link exposing the shop's cost prices is a confidentiality defect, not a feature. If supplier communication is ever needed, it gets its own spec and its own review.

## 10. Supplier ledger and reports — the payable must be explainable

### 10.1 Supplier ledger — one running story per supplier

The supplier detail view shows a single chronological ledger, the mirror of the Step 2 customer ledger (Step 2, Section 8.1). Every entry that changed what the shop owes the supplier appears once, in date order, with a running payable after it:

| Column | Content |
| --- | --- |
| Date | Purchase recording date or supplier payment date |
| Entry | Purchase: "Purchase PUR-1018 • Supplier invoice SLT-2841". Payment: "Payment • UPI" with its reference if any |
| Money effect | A purchase adds to the payable (shown as owed). A payment reduces it (shown as paid out) |
| Running payable | Payable balance after this entry |

Rules:

- **The last running payable equals the supplier's payable balance, always.** If a tester adds the purchases and subtracts the payments and gets a different number from the header payable, that is a defect.
- Ordering within one day: entries order by the time they were recorded, so a purchase recorded in the morning and paid in the evening read in that order, and the running payable never goes negative mid-day.
- Voided purchases and voided supplier payments stay visible, marked "Voided", with a reversal entry restoring what they had changed (Section 11.3). History is never silently rewritten — the same rule as Steps 2 and 3.
- The supplier detail view also lists **payment history**: every supplier payment for that supplier — date, amount, mode, reference, payable after that payment, recorded-by, status — with View / Print of the purchase documents it settled reachable per allocation. Supplier payments have no customer-style receipt and no WhatsApp resend (Section 9.3); the payment record in the ledger is their proof.

### 10.2 Reports touchpoints — no new report page in this step

Do not build a new reports screen. Ensure the data lands correctly in what Reports already shows:

- **Purchases for the period:** total purchase value (and its taxable / GST split) for the selected period, from purchase records on their recording dates. Purchases are a cost-side figure; they never reduce or inflate sales revenue figures.
- **GST payable position:** Output GST (sales GST minus credit-note GST reversals, per Steps 1 and 3) **minus ITC** (purchase GST, this step) for the period, shown as three lines — Output, Less: ITC, **Net GST payable** — so the owner and CA can see both inputs to the netting. A purchase recorded in November against an October-dated supplier bill appears with both dates visible in the purchase detail; its ITC sits in the period it was recorded in (Section 6.2).
- **Supplier payables summary:** total payable across all suppliers, plus an ageing view (0–30 days, 31–60 days, 60+ days) computed from open purchases' supplier invoice dates and balances, and a top-suppliers-by-payable list — the mirror of Step 2's dues summary, so the owner sees money owed *to* the shop and money owed *by* the shop in the same style.
- **Payments-out:** supplier payments count as money out under their mode (Cash / UPI / Card / Bank) on the **payment date**, in a payments-out view distinct from customer collections. A purchase entered on Monday and paid on Friday is Monday's purchase and Friday's payment-out. Sales collections (Step 2) and supplier payments-out must never be netted into one figure.
- **Stock valuation (where Reports already shows stock value):** current stock valued at last purchase price (Section 6.5), labelled as such.

### 10.3 A purchase's status after payments

- A purchase's status follows money owed to the supplier: Unpaid (nothing paid), Part-Paid (some paid, balance remains), Paid (balance ₹0 — whether paid at entry, later, or in instalments). Status is derived from the payment allocations, never typed by hand.
- A purchase whose goods were partly short-supplied keeps its recorded (received-quantity) total as its full liability (Section 5.3). There is no "partially received" status in Phase 1 — the recorded purchase *is* the received purchase.

## 11. Data, permissions, settings, and corrections

### 11.1 Records — fields to store

**Purchase record.** Stored as its own purchase document (a dedicated `purchases` table, or an invoice-kind record with `kind = 'purchase'` if the existing schema pattern is followed — either way it must never appear in sales queries). Reuse existing storage where the schema already provides it; add only what is missing.

| Field | Meaning |
| --- | --- |
| `purchase_number` | From the Number Series Engine, purchase series (for example `PUR-1001`) — never an invoice-series number |
| `tenant_id` | Owning business — same tenant isolation as every other record |
| `supplier_id` | Supplier (party with `type: supplier`) this purchase is from — required |
| `supplier_invoice_number` | The supplier's own invoice number, exactly as printed on their bill — required, unique per supplier among non-voided purchases (Section 5.4) |
| `supplier_invoice_date` | Date on the supplier's invoice — required |
| `purchase_date` | Date and time the purchase is recorded / goods received — the period its stock and reports figures belong to |
| `lines` | Per line: item reference, batch / expiry / MRP where tracked, billed qty, received qty, rate (minor), discount, taxable value (minor), GST rate, CGST / SGST or IGST (minor), line total (minor) |
| `other_charges_label`, `other_charges_minor`, `other_charges_gst_minor` | Filled only when other charges were entered (Section 6.3) |
| `taxable_total_minor`, `cgst_minor`, `sgst_minor`, `igst_minor`, `itc_minor`, `round_off_minor`, `total_minor` | Purchase totals, stored — reports read these, never a re-computation. `itc_minor` must equal CGST + SGST + IGST on the record |
| `amount_paid_minor`, `balance_payable_minor` | Derived from payment allocations against this purchase, kept in step with them — paid + payable must always equal `total_minor` on a non-voided purchase |
| `note` | Optional internal note — never printed on the purchase document |
| `recorded_by` | User who saved the purchase |
| `status` | posted / voided (payment status Unpaid / Part-Paid / Paid is derived, Section 10.3) |
| `void_reason`, `voided_by`, `voided_at` | Filled only when voided (Section 11.3) |
| `idempotency_key` | Client-generated key per Save submission — a retried / double submission returns the same purchase, never a second one (the same pattern Steps 2–3 used) |

**Supplier payment record.** The mirror of Step 2's payment record, in the opposite direction:

| Field | Meaning |
| --- | --- |
| `payment_number` / series | From the Number Series Engine, a supplier-payment series distinct from the customer-receipt (`RCT-`) series — for example prefix `PAY-` |
| `tenant_id`, `supplier_id` | Owning business; the supplier paid |
| `amount_minor` | Amount paid, stored in paise |
| `payment_mode`, `payment_date`, `reference`, `note` | As entered in Sections 7.1 / 7.2 (note is internal only) |
| `allocations` | Per-purchase breakdown: purchase ID + amount applied to that purchase (Section 7.2) — allocations sum exactly to `amount_minor` |
| `payable_after_minor` | Supplier payable immediately after this payment |
| `recorded_by`, `status` (recorded / voided), `void_reason`, `voided_by`, `voided_at`, `idempotency_key` | Same meanings and rules as Step 2, Section 9.1 / 9.3 |

Money is stored in minor units (paise) everywhere in this flow. No floating-point money, and no second rounding at read time.

### 11.2 Permissions (RBAC)

| Role | Create purchase | View purchases & supplier ledger | Pay supplier | Void purchase / supplier payment |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes |
| Cashier | No | No (stock quantities only, in Products) | No | No |
| Accountant | Yes | Yes | Yes | No |

Purchases expose cost prices and the shop's debts, so — deliberately unlike Steps 1–3 — the Cashier role is excluded from purchase screens and supplier payments entirely, not merely from voiding. A role without purchase permission does not see the Purchases navigation item or the Pay Supplier action at all (not a disabled button with an explanation) — the same visibility rule Steps 2–3 set for void actions. Voiding a purchase or a supplier payment moves stock, payable, and ITC, so it is Owner / Manager only, matching the void rule in every earlier step.

### 11.3 Corrections — void and re-enter, never edit or delete

- A saved purchase's lines, quantities, rates, supplier, and supplier invoice number are never editable. There is no Edit action and no Delete action for purchases. The same holds for a saved supplier payment's amount, mode, date, supplier, and allocations.
- **Void purchase flow:** Owner / Manager opens the purchase, taps Void Purchase, enters a reason (required, for example "Wrong supplier invoice number — SLT-2841 entered as SLT-2481"), and confirms. The confirmation states the full effect in plain words: "This will remove ₹{total} of purchase, take {n} units back out of stock, reduce the payable to {supplier} by ₹{balance}, and reverse ₹{itc} of ITC."
- **Void purchase effect, applied atomically:** the purchase's status becomes Voided; its inward stock moves are reversed (quantities leave stock with linked moves) — **blocked if that stock is no longer there**: if any line's received quantity has already been sold (or otherwise moved out) so reversing the inward move would push that item / batch stock negative, the void is blocked with a clear message ("{item}: only {n} of {received} units remain in stock — this purchase cannot be voided until the stock position is corrected."), and nothing changes; each payment allocation against the purchase is reversed (see the payment-void interaction below); the supplier's payable falls by the purchase's unpaid balance; its ITC is reversed in the void's period (never by rewriting the original period); and a reversal entry appears in the supplier ledger.
- **Payments against a voided purchase:** a purchase that already has supplier payments cannot be voided while those payments stand — void the supplier payment(s) first (next rule), or the void is blocked naming them ("Paid ₹{amount} against this purchase via {PAY-…}. Void that payment first."). This ordering keeps every reversal explainable one document at a time.
- **Void supplier payment flow:** Owner / Manager opens the payment from the supplier ledger / payment history, taps Void Payment, enters a reason (required), and confirms: "This will restore ₹{amount} to the payable to {supplier} and re-open the purchases it settled." Applied atomically: the payment's status becomes Voided; each allocation is reversed — the purchases it settled regain that balance and return to Unpaid / Part-Paid as their numbers dictate; the supplier's payable increases by exactly the payment amount; a reversal entry appears in the ledger. After voiding, the correct payment is recorded fresh, getting a new payment number; the voided number is never reused. The same rule and flow void the payment recorded at purchase time (7.1) — voiding it does **not** void the purchase itself, only the payment.
- A voided purchase or payment can still be viewed and (for a purchase) reprinted, clearly marked "VOIDED", so a supplier holding a copy or a question can be shown why it no longer stands.

### 11.4 Settings

No new settings page in Phase 1. This feature inherits what exists, plus the series configuration that lives where series already live:

| Existing setting | How this feature honours it |
| --- | --- |
| Document formats (existing) | Purchase document uses the shop's configured thermal size (58mm / 80mm) and A4 layout |
| Business profile incl. GSTIN and state | Drives the buyer block on the purchase document and the intra-state vs inter-state derivation (Section 6.1) |
| Number Series settings (existing) | The purchase series prefix (`PUR-` by default) and the supplier-payment series prefix (`PAY-` by default) are configured in the same place as the invoice, receipt, and credit-note prefixes — not through a new purchase-specific settings card |

If the build seems to need a purchase-specific setting (for example, a default supplier or a default payment mode), leave the behaviour fixed as this spec states and note it as a later request. Do not invent settings.

## 12. Edge cases — what must happen when things are not perfect

| Case | Required behaviour |
| --- | --- |
| Same supplier bill entered twice | Blocked at validation by the supplier + supplier-invoice-number duplicate check (Section 5.4), naming the existing purchase. If the first entry was voided, the number is free again and the re-entry saves normally |
| Supplier billed 10, only 9 received | Recorded for 9 (money, ITC, and stock all follow the received / accepted quantity) with the on-screen note from Section 5.3. The 10th unit enters only when billed again, as its own purchase |
| Goods received with no supplier bill yet (bill to follow) | Not recordable in Phase 1 — a purchase requires the supplier invoice number (Section 5.4). The shop holds the goods physically and enters the purchase when the bill arrives. Do not invent a "bill pending" state |
| Supplier has no GSTIN | Purchase saves with GST 0 on every line and ITC ₹0, with the plain note from Section 6.2. Stock and payable are unaffected |
| Inter-state supplier | IGST throughout; totals zone and document label it IGST under the ITC heading; no CGST / SGST appears anywhere on the purchase |
| Tax-inclusive supplier rates | Taxable value and ITC are backed out by the engine's inclusive method (Section 6.1) — the purchase total equals what the supplier bill says the shop owes, to the paisa |
| New item bought for the first time | Created inline (5.3) with no opening stock; its stock after save equals exactly this purchase's received quantity, and its last purchase price is this purchase's rate |
| Item's purchase rate changed since last delivery | Recorded as billed; last purchase price updates (Section 6.5); units already in stock are not revalued; selling price does not change unless the user changes it in the product master |
| Double-click / double-tap on Save Purchase | Second submission is ignored / returns the same purchase via the idempotency key; exactly one purchase, one set of stock moves, one payable effect |
| Internet drops while saving | Nothing is saved (Section 5.5 atomic rule). Screen keeps every entered line and field; user retries when the connection returns. The success modal never appears for an unsaved purchase |
| Two users enter purchases at once | Each save is independent and atomic (different supplier bills). The duplicate check (5.4) is enforced again inside the save transaction, so two users entering the *same* supplier bill simultaneously produce exactly one purchase — the second is stopped with the duplicate message |
| Purchase paid in full at entry, then voided | Void is blocked until the at-purchase payment is voided first (Section 11.3), then proceeds with its stock guard checked |
| Void attempted after part of the stock was sold | Blocked by the stock guard (Section 11.3) naming the item and the quantities. Nothing changes — no partial void, no negative stock |
| Supplier payment larger than the payable | Blocked in the modal (Section 7.2). No supplier advance is created in Phase 1 |
| Supplier payment recorded against the wrong supplier | Void and re-record against the correct supplier (Section 11.3). Payments are never re-pointed by editing |
| Purchase recorded against the wrong supplier entirely | Void and re-enter (Section 11.3) — subject to the payment and stock guards. The supplier invoice number's duplicate check is per-supplier, so the correct supplier's entry is not blocked by the voided wrong one |
| Free / zero-rate line on a supplier bill (samples) | Recordable like any line; its money and ITC are ₹0 and its received quantity still enters stock. A purchase consisting only of zero-value lines is allowed (it documents goods arriving) and its payment zone shows "No money to pay — goods receipt only" |
| Round-off on a large supplier bill | Handled by the engine's round-off line (Section 6.1): the purchase total equals the supplier bill's payable total. If a test finds the shop owing a paisa more or less than the supplier's bill, fix the calculation — never adjust the supplier invoice number or a rate to force a match |

## 13. Build steps — in this order

1. **Purchase calculation engine (backend first).** Implement the per-line purchase calculation (Section 6) — taxable, CGST / SGST or IGST, discount handling, inclusive / exclusive, other charges, round-off, ITC total — reusing the GST engine, and prove it against the worked example (Section 6.6) before any screen exists. Include the duplicate supplier-invoice guard (Section 5.4) in the same backend pass.
2. **Purchase record, supplier payment record, and atomic save.** Create the records (Section 11.1), the `PUR-` and `PAY-` number series, and the atomic save: purchase + purchase-in stock moves + payable increase + at-purchase payment and its allocation, guarded by the idempotency key.
3. **Create Purchase screen.** Supplier zone with inline supplier creation, supplier bill zone, lines table with inline item creation and batch / expiry capture, billed-vs-received quantities, live totals zone computed by the backend calculation, payment zone, and validation (Section 5.4).
4. **Purchases list, purchase detail, and document.** The list with filters and search by supplier invoice number (Section 4.1), the detail view (4.3), the purchase document (Section 9.1 — never headed "Tax Invoice", supplier invoice number always printed), and the success modal (Section 9.2). No WhatsApp / public link (Section 9.3).
5. **Pay Supplier flow.** Entry points (4.1, 4.2, 4.3), the modal with FIFO allocation preview computed by the backend (Section 7.2), and its atomic save. Prove it against the allocation example (Section 7.3).
6. **Supplier views, ledger, stock history, and voids.** Supplier payable balances (4.2), the supplier ledger and payment history (Section 10.1), purchase-in moves in stock history (Section 8.4), last purchase price on items (Section 6.5), and both void flows with their guards (Section 11.3).
7. **Reports check, permissions, and test.** Confirm Section 10.2's figures against the existing reports (purchases, ITC / net GST payable, payables ageing, payments-out), enforce the Section 11.2 role table (Cashier fully excluded), then run the full checklist in Section 14 — including the duplicate-bill case, the short-supply case, and a void blocked by sold stock — before calling this step done.

> **Definition of done for Step 4:** a manager can record a supplier purchase in under two minutes, the goods are in stock with a document behind every unit, the supplier's payable and ledger agree to the paisa, ITC for the period is exact, a later supplier payment settles the oldest purchases first — and an owner can void a wrong purchase and watch stock, payable, and ITC reverse honestly, or be told plainly why the void is blocked, with no developer in the room.

## 14. Test checklist

Tick every box. Any failure in the "must never happen" group at the end blocks release, even if everything else passes.

### 14.1 Create flow — functional

- [ ] New Purchase opens from the Purchases list with no supplier pre-selected, and from a supplier row with that supplier pre-selected; both paths produce identical purchases.
- [ ] A new supplier created inline (name, phone, GSTIN) is saved to Parties as `type: supplier` and is selected on the purchase being entered, with no entered line lost.
- [ ] A new item created inline is saved to the product master with no opening stock, appears on the purchase line, and its stock after save equals exactly the received quantity.
- [ ] Supplier invoice number and date are required; purchase date defaults to today.
- [ ] The duplicate check blocks a second entry of the same supplier + supplier invoice number and names the existing `PUR-…` and its date; after that first purchase is voided, the same number can be entered again.
- [ ] Batch-tracked lines require batch number and expiry and cannot save without them; non-batch items show no batch fields.
- [ ] Cancelling the screen — including the discard confirmation after entering lines — creates no purchase, moves no stock, and changes no payable.

### 14.2 Money, GST, ITC, and the worked example

- [ ] The worked example (Section 6.6) produces exactly: taxable ₹8,500, CGST ₹573, SGST ₹573, ITC ₹1,146, purchase total ₹9,646; paid ₹5,000 (UPI) leaves payable ₹4,646; stock +20 Shirts and +10 Detergent; last purchase prices ₹320 and ₹210.
- [ ] An inter-state supplier's purchase records IGST only — no CGST / SGST appears on its document, totals, or ITC split.
- [ ] A tax-inclusive supplier bill records a purchase total equal to the supplier bill's total, with taxable value and ITC backed out by the engine's inclusive method.
- [ ] A supplier with no GSTIN saves with GST 0 and ITC ₹0, shows the Section 6.2 note, and still raises stock and payable correctly.
- [ ] Line discounts and a bill-level discount reduce taxable value before GST, so ITC is claimed on the discounted value; other charges add to the total (and to ITC only when a GST rate was chosen for them).
- [ ] Totals zone, saved purchase, payable effect, stock quantities, and report figures all show the same purchase total to the paisa.
- [ ] A purchase at a changed rate updates the item's last purchase price and never changes its selling price.

### 14.3 Stock and document

- [ ] Every saved line creates exactly one purchase-in stock move for its received quantity, linked to the purchase (and batch where tracked); stock history shows it as a purchase-in move with the `PUR-…` number, distinct from sale-out and return-in moves.
- [ ] Short supply (billed 10, received 9) records money, ITC, and stock for 9, shows the Section 5.3 note, and leaves the item's stock exactly 9 higher.
- [ ] A zero-received line creates no stock move; a zero-value (free) line creates its stock move with ₹0 money effect.
- [ ] Purchase document (A4 and thermal) shows: "Purchase" heading (never "Tax Invoice"), internal `PUR-…` number, supplier invoice number and date always printed, per-line billed / received quantities, full tax summary labelled Input Tax Credit, total in figures (and words on A4), and a payment block whose paid + payable sum to the total.
- [ ] Reprinting reproduces the same purchase number and content; no new purchase, stock move, or payable effect is created.
- [ ] No WhatsApp share action and no public link exist anywhere for a purchase (Section 9.3).

### 14.4 Supplier payment, ledger, reports, void, and permissions

- [ ] Pay Supplier opens from the supplier row, a purchase row, and the supplier detail with the supplier pre-filled, showing total payable and open-purchase count loaded fresh at open.
- [ ] The allocation example (Section 7.3) produces exactly: PUR-1018 receives ₹4,646 and becomes Paid, PUR-1021 receives ₹354 and stays Part-Paid with ₹1,646, supplier payable ₹1,646, payment ₹5,000 Bank.
- [ ] A supplier payment above the total payable is blocked with the Section 7.2 message; no supplier advance is created.
- [ ] A payment recorded at purchase time and a payment recorded later appear identically in the supplier ledger and payment history, allocated to their purchases.
- [ ] Supplier ledger lists purchases and payments in recorded order with a running payable, and the final running payable equals the supplier header payable; voided entries stay visible, marked Voided, with reversal entries.
- [ ] Reports: purchases for the period, ITC, and Net GST payable (output − ITC) reconcile against the purchase list; supplier payments appear as payments-out on their payment date under their mode and never reduce sales collections; payables ageing buckets (0–30 / 31–60 / 60+ days) match the open purchases.
- [ ] Void purchase (Owner / Manager, with a reason) reverses the stock moves, the unpaid payable, and the ITC exactly; the voided document reprints marked "VOIDED" and its number is never reused.
- [ ] Voiding a purchase that has supplier payments is blocked naming those payments; voiding a supplier payment restores the payable and re-opens its purchases exactly, with a new payment getting a new `PAY-…` number.
- [ ] Voiding a purchase whose stock has partly been sold is blocked naming the item and quantities, and nothing changes.
- [ ] Voiding without a reason is blocked. Cashier does not see the Purchases navigation, purchase rates, Pay Supplier, or any Void action at all; Accountant can create and pay but does not see Void.
- [ ] No purchase, stock move, payable, or payment from one business is visible to or affects another business (tenant isolation — cross-tenant access returns not-found).

### 14.5 Saving safety

- [ ] Rapid double-click on Save Purchase creates exactly one purchase, one set of stock moves, and one payable effect (idempotency key returns the same purchase number on a repeat submission).
- [ ] Disconnecting the network during save leaves no purchase, no stock change, and no payable change; the screen retains every entered value for retry.
- [ ] Two users saving the same supplier bill at the same moment produce exactly one purchase; the second save is stopped by the duplicate check inside the transaction.
- [ ] Missing supplier, missing supplier invoice number, future supplier invoice date, empty lines, negative quantities / rates, and paid-now above the purchase total are all blocked inline with nothing saved.

### 14.6 Must never happen — release blockers

- [ ] Stock never increases without a purchase document behind it, and never by more than a purchase line's received quantity.
- [ ] A purchase never creates a sales invoice, output GST, or a customer balance change, and never appears in sales figures.
- [ ] ITC never exceeds the GST the supplier actually charged on the recorded (discounted, received-quantity) taxable value, and output GST and ITC are never silently netted inside a document.
- [ ] Every rupee of a purchase total is accounted for as paid or payable — paid + payable always equals the total — and a supplier payable never goes negative.
- [ ] A purchase document never presents itself as a tax invoice issued by the shop, and cost prices never appear on any customer-facing document, WhatsApp message, or public link.
- [ ] A saved purchase or supplier payment is never silently edited or deleted — corrections happen only by void-and-re-enter / void-and-re-record.
- [ ] The success modal never appears for a purchase that did not save, and a failed save never moves stock or money.

---

## Copy-paste prompt for Antigravity

Paste this into the Antigravity agent chat, with this file placed inside the project (for example in a `specs/` folder):

```text
Read the file "specs/Purchase and Stock Inward Spec.md" in this project and implement the Purchase & Stock Inward feature exactly as per the spec. Build: (1) Purchases list and Create Purchase screen with supplier selection and inline supplier creation, required supplier invoice number and date with a per-supplier duplicate check, per-line item (with inline item creation), billed and received quantities, purchase rate, discount, and GST, plus batch/expiry capture for batch-tracked items, (2) purchase calculation reusing the existing GST engine — same discount, inclusive/exclusive, and round-off rules — recording the purchase GST as Input Tax Credit (ITC), never as output tax, with its own PUR- series number, (3) atomic save that creates the purchase, purchase-in stock moves for the received quantities, the supplier payable increase, and any payment recorded at purchase time together or not at all, guarded by an idempotency key, (4) Pay Supplier modal that allocates a later payment oldest-purchase-first (FIFO) with a live allocation preview, blocking any amount above the total payable, with its own PAY- series, (5) purchase document (A4 + thermal, never headed "Tax Invoice", supplier invoice number always printed) and success modal — with no WhatsApp sharing and no public link for purchases, (6) supplier payable balances, supplier ledger with running payable and payment history, purchase-in moves in stock history, last purchase price on items, reports for purchases / ITC / net GST payable / payables ageing, and Owner/Manager void-with-reason for purchases and supplier payments with the payment-first and stock-availability guards. Enforce the spec's permissions exactly: Cashier cannot see purchases, purchase rates, or supplier payments at all. Never edit stock quantities directly as a substitute for a purchase, and do not change the GST engine's sale calculation, sales invoice numbering, khata collection, or credit note logic. Follow the build order in the spec, verify both worked examples (Sections 6.6 and 7.3) exactly to the paisa, run the test checklist at the end, and report the files you changed and the test results.
```

*When every box above is ticked, Step 4 is complete and the daily loop is closed: sell → share → collect → return → buy / restock. The roadmap moves to Step 5 — Shifts & Day-End Z-Report. That feature gets its own spec, written the same way: screen, buttons, click behaviour, and tests, before any code.*
