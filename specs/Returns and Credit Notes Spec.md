# Returns and Credit Notes Spec

**Billing Platform — Feature Specification**
Sales returns from a past bill + linked GST credit note + stock and dues reversal

> This document tells the build team exactly what to build, where each element goes, what happens on every click, and how to test it. A developer can implement the feature without a follow-up meeting, and a tester can verify it line by line.
>
> **For AI builders (Antigravity / coding agents):** Read this entire file first, then implement it exactly as written. Follow the build order in Section 13, run the test checklist in Section 14, and report the files you changed and the test results. Do not change the GST engine's tax calculation or the invoice numbering logic — reuse them. A return is **not** an edit to the original bill. The original invoice is never changed. Every correction happens through a new, linked document: a Credit Note.

| Item | Detail |
| --- | --- |
| Feature | Sales Returns & Credit Notes — Step 3 of the daily-loop roadmap |
| Priority | P0 — build after Step 1 (WhatsApp Bill Sharing) and Step 2 (Khata Payment Collection), before purchases / stock inward, shifts, and camera scan |
| Surfaces | Bills & Invoices table (Return / Credit Note action) + invoice detail + Create Credit Note screen (new) + Credit Note success modal (new) + customer ledger |
| Already built | `invoices` table already supports `kind: 'credit_note'` and `linked_invoice_id`, GST engine (CGST + SGST / IGST, inclusive / exclusive, round-off), Number Series Engine, receipt rendering (thermal 58mm / 80mm + A4), stock deduction at sale, customer dues and FIFO khata allocation (Step 2), `shared/whatsapp.ts` with EN / HI / TA templates (Steps 1–2) |
| Depends on | Posted (completed) sales invoices, item / stock master, customer master and dues (Step 2), payment records and Customer Advance (Step 2 build) |
| Out of Phase 1 | Purchase returns / debit notes to suppliers, return without a bill (no-bill returns), exchange billing in one screen (return + new sale combined), automatic refund to bank / UPI via a payment gateway |

> **How to read this spec:** Sections 1–3 are the decision record — what and why. Sections 4–10 are the build instructions — entry points, the return flow, money and GST maths, settlement, stock, and the credit note document. Section 11 is data, permissions, and corrections, Section 12 is edge cases, Section 13 is the build order, and Section 14 is the test checklist. Do not skip Section 6 (money & GST) or Section 8 (stock): a credit note with wrong GST or wrong stock is worse than no credit note, because GSTR filing and inventory both stop being trusted.

## 1. Purpose — goods come back, and today the software has no honest answer

Returns are a daily event in every shop this platform serves: a customer brings back a damaged item, the wrong size was billed, an extra quantity was added by mistake, or goods were billed but never taken. The platform today can create the original bill correctly — and then stops. There is no way to record that goods came back.

Without this step, staff do the only things they can: strike through a printed bill, hand back cash with no record, reduce the next bill informally, or — worst of all — want to edit or delete the original invoice. Every one of those workarounds breaks a record the platform has carefully kept correct until now: GST output tax stays overstated, stock stays lower than what is physically on the shelf, the customer's khata balance stays higher than what they truly owe, and the day's sales report still counts a sale that did not survive.

Sales Returns & Credit Notes close that gap the legally correct way:

- **One action** on every posted bill: Return Items / Issue Credit Note.
- **One screen** that lists the bill's items, takes the returned quantity and a reason per line, and shows the credit value and GST reversal before anything is saved.
- **One new document:** a Credit Note with its own number (for example `CN-1001`), permanently linked to the original invoice number and date — the original bill itself is never edited, never deleted.
- **Three automatic reversals, together or not at all:** stock comes back in (only for lines marked restockable), the customer's dues fall by the credit applied to that bill, and GST output tax reverses in reports in the credit note's period — exactly the amounts on the credit note, to the paisa.
- **One clear settlement:** if the bill still had dues, the credit reduces dues. If the bill was already paid, the credit becomes a refund (cash / UPI paid back) or Customer Advance the customer can use on a future bill — the cashier chooses, the customer sees it on the credit note.

Success looks like this: a customer returns 2 of 5 shirts billed yesterday on INV-1042 for ₹1,180 (including GST). The cashier opens the bill, taps Return Items, sets quantity 2 on that line, marks the shirts restockable, picks reason "Size mismatch", and confirms. In under thirty seconds a credit note CN-1014 for ₹472 is issued, 2 shirts are back in stock, the customer's dues (or advance) reflect ₹472, GST reports show the reversal, and the customer has the credit note on WhatsApp — while INV-1042 still shows exactly what was originally billed, with a clear "₹472 returned via CN-1014" marker.

## 2. Current state — what exists and what is missing

| Piece | State | Source |
| --- | --- | --- |
| Posted sales invoices (full history, statuses) | Built — Bills & Invoices table with payment breakdown, thermal + A4 views | Existing Invoices |
| Credit note storage shape | Built in schema — `invoices.kind = 'credit_note'` and `linked_invoice_id` exist | Existing DB schema (audit) |
| GST engine | Built — intra-state CGST + SGST vs inter-state IGST, inclusive / exclusive, round-off reconciliation | Existing core |
| Number Series Engine | Built — collision-free numbering with a per-business prefix | Existing core |
| Stock deduction at sale | Built — inventory reduces on checkout | Existing POS + stock moves |
| Stock moves table | Built — `stock_moves` records stock changes | Existing DB schema |
| Customer dues, FIFO allocation, Customer Advance | Built in Step 2 — dues, `payment_allocations`, `parties.advance_minor`, reversal-only corrections | Step 2 |
| Receipt / document rendering | Built — thermal 58mm / 80mm and full A4 GST documents | Existing rendering + `shared/bill.ts` |
| WhatsApp sharing (wa.me, EN / HI / TA) + public links | Built in Steps 1–2 — bill link `/b/:token`, receipt link `/r/:token`, send tracking | `shared/whatsapp.ts` + Steps 1–2 |
| Return / Credit Note action and screen | Missing — no way to start a return from a bill | To build (Sections 4–5) |
| Credit value + GST reversal calculation for returns | Missing — engine calculates tax on a sale, not yet on a partial return | To build (Section 6) |
| Settlement (dues reduction / refund / advance) | Missing | To build (Section 7) |
| Restock on return | Missing — stock only moves out today | To build (Section 8) |
| Credit Note document, print, WhatsApp, public link | Missing | To build (Section 9) |

Nothing in this feature requires changing how a sale is created, how GST is calculated on a sale, or how khata payments are recorded. If implementation appears to need one of those, stop — that is a scope error, not a requirement.

## 3. Scope

### In scope — Phase 1

- Return / Credit Note action on every posted, non-cancelled sales invoice, from the Invoices table and the invoice detail view.
- Create Credit Note screen: per-line returned quantity (partial or full-line), per-line restockable / not-restockable choice, per-line reason, and an overall note.
- Credit value calculation per line — taxable value, CGST / SGST or IGST, and total — proportional to the quantity returned, using the original bill's rates, prices, and discounts (Section 6), with a worked example that must match exactly.
- Settlement choice when the original bill was already paid: Refund Now (cash / UPI / card / bank) or Keep as Customer Advance. When the bill still has dues, credit applies to dues first automatically (Section 7).
- Stock reversal: restockable quantities return to stock with a stock move linked to the credit note; non-restockable quantities do not (Section 8).
- Credit Note document: own number series, thermal + A4 print, public hosted link, and WhatsApp share reusing the Steps 1–2 wa.me flow and language settings.
- Original invoice display: returned quantities and linked credit notes shown on the bill, without changing its totals.
- Customer ledger and reports: credit notes appear in the ledger, reduce dues / create advance correctly, and reverse sales and GST in reports in the correct period (Section 10).
- Voiding a credit note (Owner / Manager only, with a reason) as a full reversal of its stock, dues / advance, and GST effects — never a silent delete or edit.

### Out of scope — do not build in Phase 1

- **Editing or deleting the original invoice to "fix" a return.** Never. The original bill is a posted legal document. All correction is via credit note (and, for a wrong payment, via Step 2's payment reversal).
- **Returns without an original bill.** A customer with no bill / no record in the system cannot be returned in Phase 1. No-bill returns need an owner-approval policy and a fraud check that do not exist yet.
- **Purchase returns and debit notes (returns to suppliers).** That is the mirror flow on the purchase side and belongs to Step 4 (Purchases / Stock Inward). This spec is only about sales returns from customers.
- **Exchange in one transaction.** "Return this, give me that instead" is two documents in Phase 1: a credit note for the return, then a fresh bill for the replacement. A combined exchange screen is a later convenience, not a different money rule.
- **Gateway refunds.** "Refund Now" in Phase 1 records a refund the shop physically makes (cash handed back, or a UPI payment the staff sends from the shop's own app). The platform does not move money itself and must never claim it did.
- **Return window enforcement and per-item return policies.** The system warns when a return is unusually old (Section 12) but does not hard-block by age or category in Phase 1. Policy rules are a later, per-business setting.
- **Supplier claim / warranty workflows.** Marking a damaged return as "claim from supplier" is purchase-side tracking for Step 4. In Phase 1 a damaged item is simply not restocked.

## 4. Entry points — Bills & Invoices

### 4.1 The invoices table

- **Return action:** on every posted sales invoice row, an action labelled "Return / Credit Note". It sits with the row's other actions (View, Print, WhatsApp) and is never hidden for a bill that still has returnable quantity.
- **When nothing is returnable:** if every line on the bill has already been fully returned, the action is shown disabled with the tooltip "Fully returned". Do not hide it — a missing action looks like a bug; a disabled one teaches where returns live.
- **Credit note rows are not sales rows:** credit notes appear in the same table only if the existing kind filter includes them, clearly badged "Credit Note" with a negative / credit amount styling, and they never carry a Return action themselves. You cannot return a credit note; you void it (Section 11.3).
- **Cancelled bills:** a cancelled / voided invoice has no Return action. There is no live sale to return against.
- **Returned marker on the original bill:** once any credit note exists against a bill, its row shows "Returned ₹X • CN-…" (the latest credit note number, with the full list in detail). The bill's amount column still shows the original bill total — never a silently reduced total.

### 4.2 Invoice detail view

The invoice detail (the existing view / preview that shows lines, payment breakdown, and prints) gains a **Returns** zone:

| Zone | Content |
| --- | --- |
| Header | Invoice number, date, customer, bill total, amount paid, balance due — all original, unchanged |
| Lines | Original quantity per line, plus "Returned: n" on any line with returns, so remaining returnable quantity is obvious |
| Returns zone | Every credit note linked to this bill: credit note number, date, total credit, settlement type (dues / refund / advance), status (Posted / Voided), with View / Print / WhatsApp actions per credit note |
| Action | "Return Items / Issue Credit Note" button — opens the same Create flow as 4.1, with this bill pre-loaded |

### 4.3 Who can start a return — and who cannot

- Any operational role that can view invoices can open the Create screen and see the calculation (permissions to *save* are in Section 11.2).
- A walk-in bill (no customer record) can be returned. Its settlement can only be Refund Now or "adjust dues" is not applicable — there are no dues and no customer to hold advance for (Section 7.4).

## 5. The Create Credit Note screen — exact behaviour

### 5.1 Opening and closing

- **Trigger:** the Return action in 4.1 or 4.2. The original invoice is always pre-loaded from the row / view that opened the screen — the cashier never searches for the bill again inside it.
- **Fresh data on open:** line quantities, already-returned quantities, amount paid, and balance due are loaded at the moment the screen opens. If another counter returned an item from the same bill a minute earlier, this screen must show the reduced returnable quantity (see also Section 12, concurrent returns).
- **Dismissal:** Back / Cancel / close — with no credit note created, no stock moved, no dues changed. If the cashier has entered any returned quantity, dismissing asks for one confirmation ("Discard this return?") so an accidental close does not silently lose typed work.
- **One credit note per save:** one save creates exactly one credit note for the lines entered in that save. Returning more items from the same bill later is a second credit note, not an edit to the first.

### 5.2 Layout — top to bottom

| Zone | Content |
| --- | --- |
| Header | "Create Credit Note" + original invoice number and date + customer name and phone |
| Bill summary line | Bill total, amount paid on the bill, balance due on the bill — all read-only |
| Lines table | Section 5.3 — one row per original bill line |
| Reason summary | Overall note (optional) below the lines table |
| Settlement zone | Section 7 — shown once total credit is above ₹0; states exactly where the credit money goes |
| Totals zone | Section 6.4 — taxable reversal, GST reversal, round-off, total credit, always visible and live |
| Footer | "Issue Credit Note" (primary) • Cancel |

### 5.3 Lines table — per-line return entry

One row per line on the original bill. Columns, left to right:

| Column | Behaviour |
| --- | --- |
| Item | Name, SKU / barcode if present — read-only, exactly as billed |
| Billed qty | Quantity on the original bill — read-only |
| Returned so far | Total quantity already returned against this line across all posted credit notes — read-only |
| Returnable qty | Billed minus returned so far — read-only, the maximum the next column may take |
| **Return qty (input)** | Numeric, defaults to 0. Accepts fractional quantities exactly where the original line allowed them (for example weighed goods in kg); otherwise whole units only, matching the item's unit rules at billing |
| Rate | Unit price from the original bill (after that line's discount was applied at sale — see Section 6.1) — read-only |
| **Restock? (toggle)** | Defaults to **Yes** (goods go back to shelf). Cashier sets **No** for damaged / expired / opened goods. Per line, never one global toggle — a single return routinely mixes one good item and one damaged item |
| **Reason (per line)** | Required once return qty is above 0. Dropdown: Damaged / Defective • Wrong item billed • Wrong size / variant • Customer changed mind • Expired (pharmacy / food) • Excess quantity billed • Other (free text required when Other is chosen) |
| Line credit | Taxable + GST for the returned quantity on that line, computed live (Section 6) — read-only |

Quick actions above the table: "Return All" sets every row's return qty to its full returnable quantity (reasons still required per line — the cashier must still confirm them), and "Clear" resets every return qty to 0. Neither action saves anything.

Batch / expiry note (pharmacy and any batch-tracked item): where the original line carried a batch number / expiry, the row shows it read-only and the restock, if any, goes back into that same batch. Phase 1 does not let the cashier pick a different batch for a return.

### 5.4 Validation — inline, before Issue is enabled

| Input | Rule | Message / behaviour |
| --- | --- | --- |
| Every return qty is 0 | Invalid | "Return at least one item" — Issue Credit Note stays disabled |
| Return qty exceeds returnable qty on any line | Invalid | "Only {n} left to return on this item" on that row; Issue stays disabled |
| Return qty is negative, or has more precision than the item's unit allows | Invalid | Inline hint on that row; Issue stays disabled |
| A line with return qty above 0 has no reason | Invalid | Row is highlighted, "Select a reason" on that row; Issue stays disabled |
| Reason is Other with empty free text | Invalid | "Describe the reason" on that row |
| Settlement is Refund Now with no refund mode selected (Section 7) | Invalid | Hint in the settlement zone; Issue stays disabled |
| Bill was fully returned after this screen opened | Invalid | On save, re-check returnable quantities; if they no longer fit, stop and show "This bill's returnable quantity has changed. The screen has been refreshed." |

All validation is inline, on the row or zone it belongs to. No alert popups, no page reload, and no credit note is created for a failed validation.

### 5.5 Saving — one atomic update

On Issue Credit Note, the following happen together, or none of them happen:

1. A credit note record is created (Section 11.1) with its own number from the Number Series Engine (a credit-note series, for example prefix `CN-`, separate from the invoice and receipt series), `kind = 'credit_note'`, `linked_invoice_id` set to the original bill.
2. For each returned line marked restockable, a stock move returns that quantity to stock, linked to the credit note.
3. The settlement is applied (Section 7): dues on the original bill / customer are reduced, and/or a refund record, and/or Customer Advance is increased — exactly totalling the credit note total.
4. The success modal opens (Section 9.2).

If any part fails — network drop, server error — no part is saved: no credit note without its stock and dues effects, and no stock or dues change without a credit note. The screen stays open with the entered values intact and a plain error ("Credit note could not be saved. Check the connection and try again."), so the cashier can retry. A double-click on Issue Credit Note creates exactly one credit note (Section 12).

> **Rule that overrides everything in this section:** issuing a credit note must never change the original bill's lines, quantities, total, or GST. It changes only derived views of that bill — returned quantities, balance due, and status — and it changes them through the credit note record, never by rewriting the bill. If an implementation needs to edit the invoice row's totals to make a return work, it is the wrong implementation.

## 6. Money and GST rules — the credit is the sale, reversed proportionally

A credit note is not a new price negotiation. Its value is fully determined by the original bill: same rates, same discount proportion, same GST rates, same tax treatment (intra-state vs inter-state, inclusive vs exclusive). This section fixes that maths so the cashier, the owner, the customer, and the CA filing GSTR all get the same number.

### 6.1 Per-line credit calculation

For each returned line:

1. **Start from the original line's billed amounts**, not from the item's current master price. The item's price may have changed since the bill was made; a return always reverses what was actually charged.
2. **Scale proportionally by quantity:** credit for the line = original line amount × (return qty ÷ billed qty), computed separately for taxable value and for each tax component. Where the original bill applied a line discount or a bill-level discount, that discount is already inside the original line amounts the GST engine produced at sale — proportional scaling therefore carries the discount with it automatically. Do not re-apply a discount, and do not calculate the return at the undiscounted rate.
3. **Tax split follows the original bill:** an intra-state bill reverses CGST and SGST in the same proportions as charged; an inter-state bill reverses IGST. A return never converts one to the other.
4. **Inclusive / exclusive follows the original bill:** if the original prices were tax-inclusive, the returned line's taxable value is backed out with the same inclusive method the engine used at sale; if exclusive, tax is calculated on the scaled taxable value. The engine's existing sale logic is reused in reverse — no second tax formula is written for returns.
5. **Rounding:** each line's components are kept in paise (minor units) through the calculation, and the credit note's round-off line (6.4) reconciles the total exactly as invoices do, using the same round-off-to-nearest-rupee rule and the same odd-paisa handling as the GST engine. The credit note total must be a whole-rupee-payable amount consistent with the original bill's rounding, and every report must read the stored credit note amounts — never a re-computation.

### 6.2 What "returned so far" can never exceed

Across all posted (non-voided) credit notes against one bill, for each line: total returned quantity never exceeds billed quantity, total taxable reversal never exceeds the line's original taxable value, and total GST reversal never exceeds the line's original GST. The screen enforces this per save (Section 5.4), and the backend enforces it again inside the atomic save — a stale screen or a duplicate request must not be able to over-return a line.

### 6.3 Worked example — test against this exact case

Original bill **SKM-1042**, dated 20 Oct 2026, intra-state, prices tax-exclusive. Customer: Meena (registered customer, phone on record).

| Line | Item | Qty | Rate (ex-tax) | Line discount | Taxable value | GST |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Cotton Shirt | 5 | ₹400 | ₹200 (bill-level discount share already applied in taxable value below) | ₹1,800 | 12% (CGST 6% + SGST 6%) |
| 2 | Detergent 1 kg | 2 | ₹250 | ₹0 | ₹500 | 18% (CGST 9% + SGST 9%) |

Bill totals: taxable ₹2,300 • CGST ₹153 (₹108 + ₹45) • SGST ₹153 (₹108 + ₹45) • round-off ₹0 • **bill total ₹2,606**. Amount paid at billing: ₹2,000. **Balance due on the bill: ₹606.**

Return on 21 Oct 2026: **2 Cotton Shirts** (reason: Wrong size, restockable: Yes) and **1 Detergent** (reason: Damaged, restockable: No). The credit note must be exactly:

| Line | Return qty | Taxable reversal | CGST reversal | SGST reversal | Line credit total |
| --- | --- | --- | --- | --- | --- |
| Cotton Shirt | 2 of 5 | ₹720 (= 1,800 × 2/5) | ₹43.20 | ₹43.20 | ₹806.40 |
| Detergent 1 kg | 1 of 2 | ₹250 (= 500 × 1/2) | ₹22.50 | ₹22.50 | ₹295.00 |
| **Credit note CN-…** |  | **₹970** | **₹65.70** | **₹65.70** | **₹1,101.40 → total credit ₹1,101** (round-off −₹0.40, same rule as invoices) |

Settlement for this example (Section 7): balance due on the bill is ₹606, so **₹606 of the credit clears the bill's dues** (bill becomes Paid, with ₹1,101 returned against it in total history) and the **remaining ₹495 becomes Customer Advance** — unless the cashier instead chooses Refund Now for the remainder, in which case ₹495 is recorded as refunded and no advance is created. Returned quantities after this save: Shirts 2 of 5 (3 still returnable), Detergent 1 of 2 (1 still returnable). Stock effect: **+2 Shirts** back in stock; **Detergent: no stock change** (damaged, not restocked).

Every number in Section 14's checklist that refers to "the worked example" means this table. If the implementation's numbers differ by even one paisa, the calculation is wrong — investigate the discount proportion and the rounding before adjusting the example.

### 6.4 Totals zone — what the screen shows live

As return quantities are typed, the totals zone updates without any extra click:

- Taxable value reversed (sum of lines)
- CGST reversed and SGST reversed (intra-state) **or** IGST reversed (inter-state) — matching the original bill's treatment
- Round-off (shown only when non-zero, exactly as invoices show it)
- **Total credit** in bold — this is the amount that will be settled in Section 7 and printed on the credit note

The cashier must be able to predict the saved credit note from this zone alone. The preview is computed by the same backend calculation that saves the credit note, never by a second, copied calculation in the frontend.

### 6.5 What a credit note is not

- **Not an invoice edit.** Covered in Section 5.5 — stated again here because it is the mistake this feature exists to prevent.
- **Not a khata payment.** A payment (Step 2) records money received. A credit note records value reversed because goods / billing came back. Both reduce dues, but they are different ledger entry types, different documents, and different GST consequences: a payment never changes GST; a credit note always reverses the GST on the returned lines. Never use one to fake the other.
- **Not a discount on a future bill, by itself.** Credit becomes usable on a future bill only by first becoming Customer Advance (Section 7.3), which the existing advance-consumption flow then applies. Do not invent a "credit wallet" separate from advance.
- **Not a price-change tool.** If the shop simply billed at the wrong price and no goods came back, the honest Phase 1 path is still a credit note for the wrongly billed line (reason: Wrong item billed / Excess quantity billed as applicable, restockable: No where no physical stock moves) plus a fresh correct bill if goods were actually sold. Staff must not use returns to quietly rewrite prices with restockable set to Yes — that would inflate stock that never came back.

## 7. Settlement — where the credit money goes

A credit note creates value owed back to the customer. That value must land in exactly one place per rupee, and the settlement zone on the screen states it in plain words before saving. The rules below are fixed; the cashier chooses only where this spec says they choose.

### 7.1 Credit against dues first — automatic, not a choice

1. If the **original bill** still has a balance due, credit applies to that bill's dues first, up to the balance on that bill.
2. If credit remains after the original bill is cleared, it applies to the **customer's other open dues**, oldest bill first — the same FIFO order as khata payments (Step 2, Section 6) — *only when the customer is a registered customer with other open bills*, and the settlement zone shows exactly which bills it will clear before saving.
3. Applying credit to dues updates each affected bill's paid / settled position through the credit note's allocation record (Section 11.1), in the same spirit as payment allocations — but as a credit allocation, a distinct type, so reports and the ledger never confuse credit with cash received.

Treating "the bill is now settled" as if the customer had paid cash for it would corrupt collections reports. Credit-settled amounts are never counted as collections (Section 10.2).

### 7.2 Remainder — the cashier's one choice

Any credit left after Section 7.1 has cleared all dues it can is the **remainder**. The cashier picks exactly one treatment for the whole remainder:

| Option | What happens | When it is the right choice |
| --- | --- | --- |
| **Keep as Customer Advance** (default) | Remainder is added to the customer's advance balance (`parties.advance_minor`, the Step 2 mechanism), recorded on the credit note. It will be consumed by future bills through the existing advance flow | Customer shops regularly and will use it — the common case |
| **Refund Now** | A refund record is created for the remainder with a mode (Cash / UPI / Card / Bank) and optional reference. The shop physically returns the money at the counter / from its own UPI app at that moment | Customer wants their money back now, or is unlikely to return |

Rules:

- The default is **Keep as Customer Advance** — money stays honestly tracked inside the system rather than leaving with no record.
- **Refund Now requires a mode** before Issue is enabled (Section 5.4). Cash is pre-selected. A UPI / bank refund should carry its transaction reference in the optional reference field when the staff member has it.
- The platform records the refund; it does not send money (Section 3). Wording everywhere — screen, credit note, WhatsApp — is "Refund recorded", never "Refund sent to your account" or any claim about bank timelines.
- Split remainder (part advance, part refund) is **not** supported in Phase 1. One remainder, one treatment. If a real shop needs a split, note it as a later request.

### 7.3 Fully paid bill, no other dues

If the original bill was fully paid and the customer has no other open dues, the entire credit is the remainder and Section 7.2 applies to all of it. This is the most common retail return (paid yesterday, returned today) and the flow must make it one obvious choice, not an error state ("nothing to adjust").

### 7.4 Walk-in bills

A walk-in bill has no customer record, no dues beyond that bill, and nowhere to hold advance. Therefore:

- Credit first clears that bill's own balance due, if any (a part-paid walk-in bill).
- Any remainder can only be **Refund Now**. The settlement zone shows only the refund option, with the mode required. "Keep as Advance" is not shown — never create a dummy customer silently to hold it. If the customer wants store credit, staff first create the customer through the normal customer flow, attach them by re-opening the bill's customer link if the platform supports it, or record the refund — Phase 1 does not invent a shortcut here.

### 7.5 Advance already in play

If the original bill had consumed Customer Advance at billing (the Step 2 flow), a return does not need special handling in Phase 1: the credit calculation is unchanged (it is based on billed amounts, not on how the bill was paid), and settlement follows Sections 7.1–7.2. Credit that becomes advance simply increases the advance balance; it is not labelled by which bill it came from once pooled — the credit note record preserves that history.

## 8. Stock rules — what comes back to the shelf, and what must not

### 8.1 Restockable lines

- Quantity returned with Restock = Yes creates a stock move of type return-in, quantity equal to the returned quantity, linked to the credit note and to the original line / item (and batch, where batch-tracked).
- Stock increases at save time, inside the same atomic transaction as the credit note (Section 5.5). There is no separate "receive stock" step for a sales return.
- The stock move's cost / valuation follows the platform's existing stock-move convention for inward moves. Do not invent a return-specific valuation in Phase 1.

### 8.2 Non-restockable lines

- Quantity returned with Restock = No creates **no stock move**. The goods are recorded as returned on the credit note (the customer does not keep both the goods and the credit), but they do not re-enter sellable stock — they are damaged, expired, or opened.
- The credit note document shows the restock choice per line (Section 9.1) so an owner reviewing later can see that a damaged item was not quietly put back on the shelf — or quietly kept by staff. This visibility is deliberate.
- Phase 1 has no "damaged stock" / quarantine location. Non-restocked goods simply never re-enter stock counts. A quarantine / supplier-claim flow is Step 4 territory (Section 3).

### 8.3 Serial / batch-tracked items

Where an item is batch-tracked (pharmacy pack, expiry-managed food), the return goes against the batch on the original bill line (Section 5.3). If that batch has since expired, the cashier should set Restock = No with reason Expired — the system warns ("This batch expired on {date}") when Restock = Yes is selected on an expired batch, but in Phase 1 the warning does not hard-block: the owner may still be accepting it for a supplier claim outside the system. The warning and the choice both appear on the credit note record.

### 8.4 Stock reports

Return-in moves appear in stock history with their credit note number, visually distinct from purchase-in moves (Step 4) and sale-out moves. Current stock is one number the owner can trust because every movement — out at sale, back at return, in at purchase — has a document behind it.

## 9. The Credit Note document and the success modal

GST law (CGST Act, Section 34) requires a credit note to carry specific particulars and to be linked to the original invoice. The document below is built to that requirement; a CA review before launch (already in the execution plan) confirms the final wording, but no field listed here is optional decoration.

### 9.1 Credit Note content — thermal and A4

Both formats carry the same facts, laid out by the existing document rendering (thermal compact, A4 full):

| Field | Source |
| --- | --- |
| Store name, address, GSTIN, phone | Business profile |
| "Credit Note" heading | Fixed — a credit note must never look like a fresh tax invoice or a payment receipt |
| Credit note number and date | Credit note record (number from the `CN-` series; date = issue date, Section 11.1) |
| Original invoice number and date | Linked original bill — always printed; a credit note without this link is not GST-valid |
| Customer name, address / phone, GSTIN (if present) | Customer record / original bill |
| Lines | Per line: item, return qty, rate, taxable reversal, GST rate and reversal, line credit total, reason, Restock: Yes / No |
| Tax summary | Total taxable reversal, CGST + SGST reversal (intra-state) or IGST reversal (inter-state), round-off, each matching Section 6 |
| **Total credit** | In figures; A4 also shows it in words (reuse the Indian money-in-words helper added in Step 2) |
| Settlement block | Plain words stating where the credit went: dues cleared (per bill), refund (mode + reference if any), and/or advance created — amounts must sum to the total credit |
| Issued by | User who issued the credit note |

- Amounts use Indian number grouping and the ₹ symbol, formatted exactly as bills format them. The credit note total, the dues / advance / refund effects, and the GST reversal in reports must be the same numbers to the paisa.
- Reprinting a credit note later (from the invoice detail or the credit note's own view) prints the same document with the same number. A reprint never creates a new credit note number or a second stock / dues effect.
- A voided credit note reprints clearly marked "VOIDED" (Section 11.3).

### 9.2 Success modal — immediately after saving

- **Trigger:** the instant the credit note, stock moves, and settlement have saved successfully (Section 5.5). Never on a failed or partial save.
- **Header:** green tick + "Credit Note issued" + credit note number (for example CN-1014).
- **Summary lines:** original invoice number, total credit in bold, and the settlement in one line — for example "₹606 dues cleared • ₹495 kept as advance" or "₹1,101 refunded (Cash)".
- **Actions:** Print Thermal • Send on WhatsApp • View A4.
- **Footer:** "Done" (primary, closes and returns to the invoices list / invoice detail, refreshed, showing the returned marker) • Close (× in header).
- Dismissing the success modal never undoes the credit note. Correcting a wrong credit note is void-and-reissue (Section 11.3), never an undo button here.

### 9.3 WhatsApp credit note — reuse Steps 1–2, do not rebuild it

- The Send on WhatsApp action uses the same wa.me click-to-chat flow, phone rules, and settings as Steps 1–2: the number is pre-filled from the customer record (or typed inline for a walk-in bill's customer, with the same 10-digit validation), the language selector offers English / Hindi / Tamil defaulting from Settings, and the Steps 1–2 enable/disable toggle governs this button too — off in Settings means hidden here as well.
- A public hosted credit note link is created on the same pattern as the bill and receipt links (for example `/c/:token`), opening the full A4 credit note view without login, and the message includes it when the existing "include public link" setting is on.
- **Message shape** (English shown; Hindi and Tamil follow the same lines, as new credit-note templates added alongside the existing bill and receipt templates in the same style — those templates themselves are not changed):

```text
Namaste! We have issued a credit note for your return at {store_name}.

Credit Note: {credit_note_number}  •  Date: {credit_note_date}
Against Bill: {invoice_number}  •  Dated: {invoice_date}
Total credit: {total_credit}
{settlement_line}

View your credit note: {credit_note_link}     <- include only when public link is enabled

Thank you!
```

| Placeholder | Filled from | Example |
| --- | --- | --- |
| `{store_name}` | Business profile | Sri Kumaran Stores |
| `{credit_note_number}` | Credit note record | CN-1014 |
| `{credit_note_date}` | Credit note record | 21 Oct 2026 |
| `{invoice_number}` / `{invoice_date}` | Original bill | SKM-1042 / 20 Oct 2026 |
| `{total_credit}` | Credit note total | ₹1,101 |
| `{settlement_line}` | Settlement (Section 7), exactly one of the rows below | See below |
| `{credit_note_link}` | Public link (only when enabled) | (hosted `/c/…` URL) |

`{settlement_line}` is exactly one of:

| Situation | Line |
| --- | --- |
| All credit cleared dues | "This amount has been adjusted against your pending dues. Balance remaining: {balance_after}." — or, when dues are now ₹0: "Your pending dues are now fully cleared." |
| Remainder kept as advance | "₹{advance_amount} is kept as advance with us for your next purchase." (preceded by the dues line above when dues were also cleared) |
| Remainder refunded | "₹{refund_amount} has been refunded by {refund_mode}." |
| Walk-in, fully refunded | "₹{refund_amount} has been refunded by {refund_mode}." |

- Send tracking follows the Steps 1–2 pattern, recorded on the credit note record: send count, last-sent timestamp, destination number, language, and sending user. The label honesty rule carries over: Phase 1 opens WhatsApp, it cannot confirm delivery — the UI must never claim "Delivered" or "Read".
- **WhatsApp failure never blocks the return.** The credit note is already saved before the success modal opens. A missing phone, an invalid number, or WhatsApp being unavailable affects only the share action; Print, A4, and Done work regardless — the same rule Steps 1 and 2 set.

## 10. Ledger and reports — the reversal must land in the right period

### 10.1 Customer ledger

The customer ledger built in Step 2 (Section 8.1 of that spec) gains a third entry type:

| Column | Credit note entry |
| --- | --- |
| Date | Credit note date |
| Entry | "Credit Note CN-1014 • against SKM-1042" |
| Money effect | Reduces the balance by the portion of credit applied to dues; the advance / refund remainder is shown as an informational sub-line on the same entry, because it did not reduce dues |
| Running balance | Balance due after this entry — the final running balance must still always equal the customer's balance due |

Voided credit notes stay visible, marked "Voided", with a reversal entry restoring what they had reduced (Section 11.3). History is never silently rewritten — the same rule as voided payments.

### 10.2 Reports touchpoints — no new report page in this step

Do not build a new reports screen. Ensure the data lands correctly in what Reports already shows:

- **Sales and GST are reversed in the credit note's period, not the original bill's period.** A bill sold in October and returned in November stays in October's sales; November's reports show the credit note as a reduction of sales, taxable value, and output GST. Back-dating a reversal into a filed period would silently rewrite a closed month — never do it. (GST filing follows the same principle: the credit note is declared in the return for the period it is issued in.)
- **Collections are untouched by dues-settlement credit.** Credit applied to dues (Section 7.1) is not cash, UPI, or any collection mode, and must not increase any payment-method collection figure. A recorded Refund Now (Section 7.2) *does* appear — as money paid out, shown distinctly from collections (for example a "Refunds paid" line in the payment breakdown), on the credit note's date, under its refund mode.
- **Returns visibility:** the existing reports gain two figures: total credit notes value for the period, and returns as a share of sales. Both come from credit note records; if a tester cannot reconcile them against the credit notes list for the period, that is a defect.
- **GSTR-ready summaries** (from the core GST work) pick up credit notes as their own document type with original-invoice linkage, per Section 34 — a credit note must never be netted invisibly inside a sales figure with no document trail.

### 10.3 The original bill's status after returns

- A bill's payment / dues status continues to follow money owed: if a credit note clears its remaining balance, the bill shows as settled (Paid) — with the Returns zone (Section 4.2) making clear that part of that settlement was credit, not payment.
- A bill whose every line is fully returned is badged "Fully Returned" in addition to its settlement status. It is not deleted, not cancelled, and its totals never change.

## 11. Data, permissions, settings, and corrections

### 11.1 Credit note record — fields to store

A credit note is stored as an invoice-kind record (`kind = 'credit_note'`), linked and extended as follows. Reuse the existing invoice storage where the schema already provides it; add only what is missing.

| Field | Meaning |
| --- | --- |
| `credit_note_number` | From the Number Series Engine, credit-note series (for example `CN-1001`) — never an invoice-series number |
| `tenant_id` | Owning business — same tenant isolation as every other record |
| `linked_invoice_id` | The original sales invoice this credit note returns against — required, never null |
| `customer_id` | Customer from the original bill (null for walk-in bills) |
| `credit_note_date` | Date and time the credit note is issued — the period its GST reversal belongs to (Section 10.2) |
| `lines` | Per returned line: original line reference, item, billed qty, returned qty, rate, taxable reversal (minor), CGST / SGST or IGST reversal (minor), reason, `restock` (true / false), batch reference where applicable |
| `taxable_total_minor`, `cgst_minor`, `sgst_minor`, `igst_minor`, `round_off_minor`, `total_credit_minor` | Credit note totals, stored — reports read these, never a re-computation |
| `allocations` | Per-bill credit allocation: invoice ID + amount of credit applied to that bill's dues (Section 7.1) — distinct type from payment allocations |
| `refund_amount_minor`, `refund_mode`, `refund_reference` | Filled only when any part was settled as Refund Now (Section 7.2) |
| `advance_amount_minor` | Filled only when any part was kept as Customer Advance (Section 7.2) — allocations + refund + advance must sum exactly to `total_credit_minor` |
| `note` | Optional overall note from the Create screen — internal, with reasons per line carrying the customer-facing record |
| `issued_by` | User who issued the credit note |
| `status` | posted / voided |
| `void_reason`, `voided_by`, `voided_at` | Filled only when voided (Section 11.3) |
| `share_token` | Token for the public hosted credit note link (Section 9.3) |
| `idempotency_key` | Client-generated key per Issue submission — a retried / double submission returns the same credit note, never a second one (the same pattern Step 2 used for payments) |
| `whatsapp_send_count`, `whatsapp_last_sent_at`, `whatsapp_last_sent_to`, `whatsapp_last_language`, `whatsapp_last_sent_by` | Share tracking, same fields and meaning as Steps 1–2 |

Money is stored in minor units (paise) everywhere in this flow. No floating-point money, and no second rounding at read time.

### 11.2 Permissions (RBAC)

| Role | Issue a credit note | View credit notes | Void a credit note | Reprint / resend |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes |
| Cashier | Yes | Yes | No | Yes |
| Accountant | Yes | Yes | No | Yes |

Returns happen at the counter all day, so every operational role can issue — matching how Steps 1 and 2 let every role share a bill and collect a payment. Undoing one moves stock and GST, so voiding is Owner / Manager only. A role without void permission does not see the Void action at all (not a disabled button with an explanation).

Large returns: Phase 1 sets no amount ceiling on who may issue. If pilot shops ask for an approval limit (for example, Manager approval above ₹5,000), that is a settings addition later — do not invent a blocking approval flow now.

### 11.3 Corrections — void and reissue, never edit or delete

- A saved credit note's lines, quantities, amounts, settlement, and restock choices are never editable. There is no Edit action and no Delete action for credit notes.
- **Void flow:** Owner / Manager opens the credit note, taps Void Credit Note, enters a reason (required, for example "Wrong quantity — 2 returned instead of 1"), and confirms. The confirmation states the full effect in plain words: "This will remove ₹X of credit, re-open ₹Y of dues (or reduce advance / record the refund as not paid), take {n} restocked items back out of stock, and reverse this credit note's GST adjustment."
- **Void effect, applied atomically:** the credit note's status becomes Voided; each credit allocation is reversed (bills regain the balance the credit had cleared, returning to Unpaid / Part-Paid as their numbers dictate); any advance created by it is reduced by the same amount — and if that advance has already been consumed by a later bill, the void is **blocked** with a clear message ("₹X of this credit was already used on bill {number}. Reverse that usage first."), following the same guard Step 2 set for payment reversals; any refund recorded on it is marked reversed (the shop is responsible for recovering the physical refund outside the system — the record must say so in the void confirmation); restocked quantities are taken back out of stock with a linked stock move; and the GST reversal is itself reversed in the void's period. A reversal entry appears in the customer ledger.
- After voiding, the correct credit note is issued fresh through the normal Create flow, getting a new credit note number. The voided number is never reused.
- A voided credit note can still be viewed and reprinted, clearly marked "VOIDED", so a customer holding the old document can be shown why it no longer stands.

### 11.4 Settings

No new settings page in Phase 1. This feature inherits what exists, plus one default that lives on the Create screen, not in Settings:

| Existing setting | How this feature honours it |
| --- | --- |
| WhatsApp sharing on / off (Steps 1–2) | Off also hides Send on WhatsApp for credit notes and the resend action |
| Default WhatsApp language (Steps 1–2) | Pre-selected language for the credit note message |
| Include public bill link (Steps 1–2) | Same on / off governs the credit note public link |
| Document formats (existing) | Credit note uses the shop's configured thermal size (58mm / 80mm) and A4 layout |

The credit-note series prefix (`CN-` by default) is configured through the existing Number Series settings, in the same place as the invoice and receipt prefixes — not through a new returns-specific settings card. If the build seems to need a returns-specific setting (for example, a default return reason), leave the behaviour fixed as this spec states and note it as a later request.

## 12. Edge cases — what must happen when things are not perfect

| Case | Required behaviour |
| --- | --- |
| Full return of every line, full quantity | Allowed. Bill is badged Fully Returned, all restockable stock returns, settlement follows Section 7 on the full bill total (minus any amount already credited by earlier partial credit notes) |
| Second and third partial returns on the same bill | Each is its own credit note. Returnable qty always reflects all earlier posted credit notes; voided credit notes free their quantities back up |
| Return qty typed above returnable qty | Blocked inline before saving (Section 5.4). Nothing is saved; no partial save of the valid rows on the same screen |
| Double-click / double-tap on Issue Credit Note | Second submission is ignored / returns the same credit note via the idempotency key; exactly one credit note, one stock effect, one settlement result |
| Internet drops while saving | Nothing is saved (Section 5.5 atomic rule). Screen keeps the entered quantities, reasons, and settlement choice; cashier retries when the connection returns. The customer is never shown a success modal for an unsaved credit note |
| Two counters return from the same bill at once | The second save re-checks returnable quantities first (Section 5.4). If a line no longer has the quantity, it stops with the "quantity has changed / refreshed" message instead of over-returning the line |
| Bill already partly paid by khata collection (Step 2) | No special case: credit is calculated from billed amounts, settlement clears remaining dues first, remainder follows Section 7.2. Past payments are never edited by a return |
| Bill settled partly by an earlier credit note | That credit is part of the bill's settled position. A new return calculates from billed amounts and remaining returnable quantities only — it never "re-credits" value an earlier credit note already returned |
| Customer returns an item at a changed master price | Irrelevant by design: the credit uses the original bill's rate and discount proportion (Section 6.1), never today's price |
| Damaged item marked Restock = Yes by mistake | Corrected by void-and-reissue (Section 11.3) if the credit note is wrong, or by a stock adjustment outside this feature if only the shelf count is wrong. Staff must not edit the credit note's restock flag after saving |
| Return long after the bill (for example, 90 days) | Allowed in Phase 1, but the Create screen shows a plain warning: "This bill is {n} days old." The owner decides shop policy at the counter; the system records the credit note date as today, so GST reversal lands in the current period (Section 10.2) |
| Credit note issued in a later GST period than the bill | Normal and expected — see Section 10.2. Never back-date a credit note into the bill's period; the date field defaults to today and cannot be set before the original bill's date, and a future date is rejected with an inline hint |
| Customer has no phone | Credit note issues and prints normally. The success modal's WhatsApp action shows the empty phone field with inline correction, exactly as Steps 1–2 handle it; Done and Print are unaffected |
| Walk-in bill return | Allowed, refund-only remainder (Section 7.4). No customer is created silently, no advance is stored against nobody |
| Refund recorded but staff forget to actually pay the customer | Outside the software's control — but the credit note and ledger record "Refund recorded" with mode and time, so the owner's record of what *should* have been paid always exists for reconciliation. Never soften this wording to hide the gap |
| Free / zero-value line on the original bill (for example, a freebie) | Returnable like any line; its credit is ₹0. It may be restocked. A credit note consisting only of zero-value lines is allowed (it documents the goods coming back) and its settlement zone shows "No money to settle — goods return only" |
| Round-off makes a full return differ by a paisa from the bill | The proportional calculation plus the credit note round-off (Section 6.1) must still reconcile: total credit across all credit notes against a fully returned bill equals the original bill total exactly. If a test finds a one-paisa residue, fix the calculation — never leave a permanent ₹0.01 due on a fully returned bill |

## 13. Build steps — in this order

1. **Credit calculation engine (backend first).** Implement the per-line proportional reversal (Section 6) — taxable, CGST / SGST or IGST, discount proportion, inclusive / exclusive, round-off — reusing the GST engine, and prove it against the worked example (Section 6.3) before any screen exists. Include the over-return guards (Section 6.2) inside the same transaction.
2. **Credit note record and atomic save.** Create the record (Section 11.1), the `CN-` number series, and the atomic save: credit note + restock stock moves + dues allocations + refund / advance settlement, guarded by the idempotency key.
3. **Create Credit Note screen.** Entry points in the table and detail view, lines table with return qty / restock / reason, live totals zone computed by the backend calculation, validation (Section 5.4), and the settlement zone (Section 7) including the walk-in variant.
4. **Credit Note document and success modal.** Print Thermal, View A4, and the document content from Section 9.1 — with original-invoice linkage always printed and the settlement block summing to the total credit.
5. **WhatsApp credit note.** Add the credit-note templates (EN / HI / TA) in the Steps 1–2 style, the public link (`/c/:token`), the share action, and send tracking; honour the existing settings.
6. **Ledger, reports, original-bill markers, and void.** Credit entries in the customer ledger, the reports rules in Section 10.2 (period-correct GST reversal, no fake collections, refunds-paid line), returned markers on the original bill, and the void flow (Section 11.3) with its advance-consumed guard and permissions.
7. **Test.** Run the full checklist in Section 14 — including the worked example to the paisa, the two-counter concurrency case, and a void of an advance-funded credit note — before calling this step done.

> **Definition of done for Step 3:** a cashier can return part or all of any posted bill in under a minute, the customer leaves with a printed or WhatsApp credit note linked to their original bill, stock, dues / advance, and GST reports all move by exactly the credit note's amounts in the correct period, the original bill is provably unchanged — and an owner can void a wrong credit note and watch every one of those effects reverse honestly, with no developer in the room.

## 14. Test checklist

Tick every box. Any failure in the "must never happen" group at the end blocks release, even if everything else passes.

### 14.1 Create flow — functional

- [ ] Return / Credit Note appears on every posted sales invoice, and the Create screen opens with that bill's lines, billed / returned / returnable quantities, amount paid, and balance due pre-filled.
- [ ] The action is disabled with "Fully returned" once every line is fully returned, and absent on cancelled bills and on credit note rows.
- [ ] Partial return: entering a quantity below the billed quantity computes that line's credit live and leaves the rest of the line returnable afterwards.
- [ ] "Return All" fills every row to its returnable quantity; "Clear" resets all quantities to 0; neither saves anything.
- [ ] A per-line reason is required for every line with a quantity above 0; "Other" requires free text.
- [ ] Restock defaults to Yes per line and can be set to No per line independently on the same credit note.
- [ ] Cancelling the screen — including the discard confirmation after entering quantities — creates no credit note, moves no stock, and changes no dues.
- [ ] A fully paid bill with no dues offers the remainder choice (Advance default / Refund Now) for the entire credit (Section 7.3).

### 14.2 Money, GST, and the worked example

- [ ] The worked example (Section 6.3) produces exactly: taxable reversal ₹970, CGST ₹65.70, SGST ₹65.70, total credit ₹1,101 after round-off; ₹606 clears the bill's dues and ₹495 becomes advance (or is refunded, when Refund Now is chosen).
- [ ] The worked example's stock effect is exactly +2 Shirts and no Detergent movement.
- [ ] An inter-state (IGST) bill reverses IGST only — no CGST / SGST appears on its credit note.
- [ ] A tax-inclusive bill reverses the same total the customer actually paid for the returned quantity — not the ex-tax rate multiplied naively.
- [ ] Returning at a changed item master price still credits the original bill's rate (Section 6.1).
- [ ] Returning every line in full, across one or several credit notes, credits exactly the original bill total — no paisa residue remains due (Section 12).
- [ ] Totals zone, saved credit note, settlement effects, and report figures all show the same total credit to the paisa.

### 14.3 Settlement, stock, and document

- [ ] Credit against a part-paid bill clears that bill's dues first; the bill shows as settled with its Returns zone explaining the credit portion.
- [ ] Credit larger than the original bill's dues clears the customer's older open bills next, oldest first, and the settlement zone previewed exactly those bills before saving.
- [ ] Advance remainder increases the customer's advance balance by exactly the remainder and is consumable by a later bill through the Step 2 advance flow.
- [ ] Refund Now requires a mode, records mode + reference, and the amount appears as refunds paid (not negative collections) in reports on the credit note date.
- [ ] Walk-in bill: no Advance option is shown; remainder is refund-only; no dummy customer is created.
- [ ] Credit note document (thermal and A4) shows: "Credit Note" heading, CN number and date, original invoice number and date, per-line reason and Restock flag, full tax summary, total credit in figures (and words on A4), and a settlement block summing to the total credit.
- [ ] Reprinting reproduces the same credit note number and content; no new credit note, stock move, or settlement is created.
- [ ] A credit note never presents itself as a fresh tax invoice or as a payment receipt.

### 14.4 WhatsApp, ledger, reports, void, and permissions

- [ ] WhatsApp credit note opens with the customer's number and the correct settlement line for the case (dues cleared / advance kept / refunded); the public link is included only when the setting is on, and the public page opens without login showing the full A4 credit note.
- [ ] English, Hindi, and Tamil credit note messages each render completely — no raw `{placeholder}` text reaches WhatsApp, and Indic text displays correctly on Android, iOS, and WhatsApp Web.
- [ ] WhatsApp send tracking (count, time, number, language, user) is recorded on the credit note, and the UI never claims "Delivered" or "Read".
- [ ] Turning WhatsApp sharing off in Settings hides the credit note share and resend actions, and nothing else in this feature changes.
- [ ] Ledger shows the credit note entry with its dues effect and running balance; the final running balance equals the customer's balance due; advance / refund remainders appear as sub-lines.
- [ ] Reports: a return issued today against last month's bill reduces today's period sales / GST figures and leaves last month's untouched; credit-settled dues do not appear in any collection mode.
- [ ] Void (Owner / Manager, with a reason) reverses the credit allocations, restocked stock, advance, and GST effect exactly; the voided entry stays visible, marked Voided, and its document reprints marked "VOIDED".
- [ ] Voiding a credit note whose advance was already consumed by a later bill is blocked with the clear message (Section 11.3). Voiding without a reason is blocked. Cashier and Accountant do not see the Void action at all.
- [ ] After a void, reissuing the correct credit note gets a new CN number, and the voided number is never reused.
- [ ] No credit note, stock move, or settlement from one business is visible to or affects another business (tenant isolation).

### 14.5 Saving safety

- [ ] Record Payment-style double submission: rapid double-click on Issue Credit Note creates exactly one credit note, one set of stock moves, and one settlement.
- [ ] Disconnecting the network during save leaves no credit note, no stock change, and no dues / advance change; the screen retains the entered values for retry.
- [ ] Two simultaneous returns against one bill cannot over-return any line; the second is stopped and refreshed (Section 12).
- [ ] Return qty above returnable, negative quantities, and missing reasons are all blocked inline with nothing saved.

### 14.6 Must never happen — release blockers

- [ ] A return never edits, rewrites, or deletes the original invoice — its lines, quantities, total, and GST are byte-for-byte what was issued.
- [ ] A credit note never reverses more quantity, taxable value, or GST on a line than the original bill charged.
- [ ] Stock never increases for a line marked not restockable, and never increases without a credit note behind it.
- [ ] Credit never disappears: every rupee of a credit note is accounted for as dues cleared, refund recorded, or advance created — the three always sum to the total credit.
- [ ] Credit applied to dues never appears as a cash / UPI collection, and a credit note never changes a past period's reported sales or GST.
- [ ] A saved credit note is never silently edited or deleted — corrections happen only by void-and-reissue.
- [ ] The success modal never appears for a credit note that did not save, and a failed save never moves stock or money.

---

## Copy-paste prompt for Antigravity

Paste this into the Antigravity agent chat, with this file placed inside the project (for example in a `specs/` folder):

```text
Read the file "specs/Returns and Credit Notes Spec.md" in this project and implement the Sales Returns & Credit Notes feature exactly as per the spec. Build: (1) Return / Credit Note action on Bills & Invoices and the invoice detail view, (2) Create Credit Note screen with per-line return quantity, restock Yes/No, and per-line reason, with live totals, (3) credit calculation that reverses the original bill proportionally — same rates, discount proportion, CGST+SGST or IGST, inclusive/exclusive, and round-off — reusing the existing GST engine, issuing a credit note with its own CN- series number, kind 'credit_note', linked to the original invoice, (4) settlement that clears dues first (original bill, then oldest-first other dues), with any remainder kept as Customer Advance by default or recorded as Refund Now, (5) restock stock moves only for restockable lines, (6) credit note success modal with Print Thermal, Send on WhatsApp, and View A4, reusing the existing shared/whatsapp.ts flow, public link pattern, and Steps 1–2 settings, plus the customer ledger entry, period-correct reports reversal, and Owner/Manager void-with-reason. Never edit, rewrite, or delete the original invoice, and do not change the GST engine's sale calculation or invoice numbering logic. Follow the build order in the spec, verify the worked example in Section 6.3 exactly to the paisa, run the test checklist at the end, and report the files you changed and the test results.
```

*When every box above is ticked, Step 3 is complete and the roadmap moves to Step 4 — Purchases & Stock Inward. That feature gets its own spec, written the same way: screen, buttons, click behaviour, and tests, before any code.*
