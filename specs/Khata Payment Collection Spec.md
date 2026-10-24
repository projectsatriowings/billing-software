Khata Payment Collection Spec

Step 2 of the billing platform roadmap — Collect Payment against customer credit (Khata) balances, with allocation to invoices, a printed and WhatsApp receipt, and a full audit trail.


| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Item | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Detail |
| --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Document type | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Build specification — hand this file to the developer / AI builder as the single source of truth for this feature |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Feature | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Khata Payment Collection (payment inward against outstanding customer dues, outside a new sale) |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Roadmap position | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Step 2 of 6. Step 1 (WhatsApp Bill Sharing) is complete and its infrastructure is reused here. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Screens touched | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Customers &amp; Khata, Customer Detail / Ledger, Invoices (payment status), Reports, Settings |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Backend areas | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>New payments and payment_allocations data, customer balance recomputation, receipt rendering, WhatsApp send tracking |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Reuse — do not rebuild | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>shared/whatsapp.ts (phone normalisation + EN / HI / TA templates), public bill link pattern /b/:token, thermal + A4 receipt rendering, existing RBAC and tenant_id scoping |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Do not change | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>GST tax engine, invoice number series logic, checkout / POS sale flow, Step 1 WhatsApp bill-sharing behaviour |




# Instructions for the AI builder / developer


Read this entire spec before writing code. Build in the order given in Section 15. Where this spec names an existing file, table, or pattern, use it — do not invent a parallel system. If any rule in this spec conflicts with something already in the codebase, follow this spec and report the conflict in your final summary instead of silently choosing. All money is stored and calculated in paise (minor units), exactly as the existing schema does (for example opening_cash_minor). Never use floating-point rupees for balance math. At the end, run every test in Section 16 and report: files changed, new tables / fields added, and the pass/fail result of each test.


# 1. Purpose — why this feature, why now


Khata is the customer's credit ledger: the record of how much a customer still owes the shop for goods already taken. Today the platform shows Khata balances on the Customers &amp; Khata screen, but there is no way to record money coming in against those dues outside a new sale. A cashier who receives Rs 300 from a customer against an old Rs 500 due has nowhere correct to put it, so the balance stays wrong and the shop's daily cash total stays wrong.

This feature closes that gap. It is the second step in closing the daily shop loop — bill, share, collect, return, stock in, day-end — because collection is a daily, money-critical action. After this step, every rupee a customer owes and every rupee they pay is recorded in one place, allocated to the actual bills it settles, and provable with a receipt.

The definition of success is simple: a cashier can collect any payment, in any mode, in under 30 seconds; the customer's balance drops by exactly that amount; the affected bills show the correct paid / part-paid status; and the owner can later see who collected it, when, and against which bills.


# 2. Scope



## In scope for this build


A Collect Payment action and modal on the Customers &amp; Khata list and on the Customer Detail view.

Payment fields: amount, mode (Cash, UPI, Card, Bank Transfer, Cheque), date/time, reference number, and note.

Allocation of a payment across the customer's unpaid invoices — oldest first by default, manually adjustable.

Advance / on-account handling when a payment exceeds total dues or no dues exist.

Live balance math in the modal: current dues, this payment, balance after payment.

A payment receipt: thermal print, A4 print, and WhatsApp send reusing the Step 1 infrastructure, with its own receipt link and send tracking.

A customer ledger (statement) view showing bills, payments, and running balance in date order.

Corrections by reversal only, with reason and permission control (Section 11).

Reports and dashboard impact: collections counted in payment-mode totals and the day's collections figure (Section 13).


## Out of scope — do not build now


Vendor / supplier payments (paying for purchases). That belongs to the Purchase &amp; Stock Inward step.

Online payment gateway collection (payment links that charge a card automatically, auto-reconciliation with a bank feed).

Interest, late fees, or penalty calculation on overdue Khata.

Automated payment reminders or scheduled WhatsApp reminder campaigns.

Splitting one payment across two different customers, or transferring dues between customers.

Editing or deleting a posted payment in place. Corrections happen only by reversal (Section 11).


# 3. Concepts the whole team must use the same way



| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Term | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Meaning in this platform |
| --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Khata balance (dues) | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Total unpaid amount the customer owes right now: sum of unpaid invoice balances minus any advance held. Always &gt;= 0 in display; a negative position is shown as Advance, never as a negative due. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Invoice balance | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Invoice total minus amounts already allocated to that invoice from checkout payments and Khata collections. Zero means fully paid. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Payment (payment inward) | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Money received from a customer outside a new sale. One payment has one receipt number and can settle parts of several invoices. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Allocation | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>The link between a payment and an invoice: how much of this payment settled how much of that invoice. Allocations are data, not just display — reports and reversals depend on them. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Advance (on-account) | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>The part of a payment not allocated to any existing invoice. It is held against the customer and must be offered for use at their next checkout or next collection. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Reversal | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>A cancelling entry that undoes a payment's effect while keeping the original record visible. The opposite of deletion. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Receipt number | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>System-generated, sequential per business, from the existing number-series engine (for example RCT-1001). Never typed by the user, never reused. |




# 4. Entry points and who can do what



## Where Collect Payment appears


Customers &amp; Khata list: a Collect Payment button on every customer row whose balance is greater than zero. For zero-balance customers the button still appears (to record an advance) but is not highlighted.

Customer Detail / Ledger view: a primary Collect Payment button in the header, next to the balance summary.

Invoices table: for a part-paid or unpaid invoice, a row action Collect Payment that opens the same modal pre-focused on that customer with that invoice pre-selected in the allocation list.

Not at POS checkout: checkout already records payment against the new bill itself. Do not add Khata collection inside the checkout success modal built in Step 1.


## Permissions (existing RBAC)



| <w:tcPr><w:tcW w:type="dxa" w:w="3744"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Action | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Owner | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Manager | <w:tcPr><w:tcW w:type="dxa" w:w="2160"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Cashier | <w:tcPr><w:tcW w:type="dxa" w:w="1584"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Accountant |
| --- | --- | --- | --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="3744"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Collect a payment and print / send receipt | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="2160"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="1584"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes |
| <w:tcPr><w:tcW w:type="dxa" w:w="3744"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Collect a payment dated before today (backdated) | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="2160"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>No | <w:tcPr><w:tcW w:type="dxa" w:w="1584"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes |
| <w:tcPr><w:tcW w:type="dxa" w:w="3744"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Reverse a payment | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="2160"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>No | <w:tcPr><w:tcW w:type="dxa" w:w="1584"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>No |
| <w:tcPr><w:tcW w:type="dxa" w:w="3744"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>View Khata ledger and collection reports | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="1296"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes | <w:tcPr><w:tcW w:type="dxa" w:w="2160"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Own collections only | <w:tcPr><w:tcW w:type="dxa" w:w="1584"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Yes |



Cashiers must never see a working Reverse control — hide it, do not merely disable it. All permission checks are enforced on the server, not only in the UI.


# 5. The Collect Payment modal


One modal is used from every entry point. It opens with the customer locked in — a payment is always collected for exactly one customer; changing customer means closing and reopening from the right row. This prevents the most expensive Khata mistake: posting money to the wrong person's account.


## Header block (read-only)


Customer name, phone number, and GSTIN if present.

Current total dues, number of unpaid / part-paid invoices, and oldest unpaid invoice date (for example: Dues Rs 1,250 across 3 bills, oldest 12 Oct 2026).

Any advance already held for this customer, shown separately (for example: Advance available Rs 200).


## Fields the user fills



| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Field | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Rule |
| --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Amount received | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Required. Numeric, greater than zero, maximum two decimal places. Quick-fill chips: Full Dues (fills the exact total dues), and round amounts Rs 100 / Rs 500 / Rs 1,000 where they do not exceed dues plus a sensible advance. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Payment mode | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Required. Cash (default), UPI, Card, Bank Transfer, Cheque. One mode per payment — a part-cash part-UPI collection is recorded as two payments, and the modal offers Save &amp; Add Another for exactly this case. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Reference / UTR / cheque no. | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Optional for Cash. Strongly prompted (warning, not block) for UPI, Bank Transfer, and Cheque. Stored and printed on the receipt. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Date &amp; time | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Defaults to now. Editable within the permission rules in Section 4. Future dates are blocked. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Received by | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Set automatically from the logged-in user. Never editable. Shown on the receipt and in reports. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2304"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Note | <w:tcPr><w:tcW w:type="dxa" w:w="7776"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Optional free text, maximum 200 characters (for example: Paid at home delivery). Printed on the A4 receipt, not on thermal. |




## Live summary block (always visible, updates as the user types)


Current dues: Rs X.

This payment: Rs Y (echoes the amount field).

Allocated to bills: Rs A (from Section 6). Advance created: Rs (Y - A), shown only when greater than zero, labelled clearly as Advance — money held for future bills.

Balance after this payment: Rs (X - A). This is the number the customer cares about; it must be the largest, boldest figure in the summary.


## Buttons


Save Payment: validates, saves, closes the modal, and opens the receipt success view (Section 9). Disabled while a save is in progress to prevent double-posting from a double click.

Save &amp; Add Another: saves, then reopens a fresh modal for the same customer (used for split-mode collections).

Cancel: closes without saving. If the user has typed an amount, ask once: Discard this payment entry?

Note: Saving a Khata payment must never be blocked by WhatsApp, printing, or network extras. The payment record is saved first; receipt and sharing are follow-on actions that may fail without affecting the saved payment (same principle as Step 1: sharing failure never blocks billing).


# 6. Allocation — which bills this payment settles


Allocation is what turns a pile of money into correct accounts. Every saved payment must state, bill by bill, what it settled. The default behaviour must be right for the common case so most collections need zero allocation effort.

Default — oldest first: when the modal opens or the amount changes, auto-allocate the amount to the oldest unpaid invoice first, then the next oldest, until the amount runs out. This matches how shopkeepers and customers naturally think: clear the old bill first.

Visible list: show every unpaid / part-paid invoice for the customer: invoice number, date, invoice total, already paid, balance, and an editable This Payment amount per row, pre-filled by the oldest-first rule.

Manual override: the user may change any row's amount (for example, a customer who disputes bill 2 but pays bill 3 in full). Row amount must be &gt;= 0 and &lt;= that invoice's balance. The list total must equal the allocated total in the summary block, live.

Remainder: any amount not allocated when saving becomes Advance (Section 3). The save confirmation line states this plainly before posting when an advance will be created: Rs 150 of this payment will be kept as advance.

Pre-selected invoice: when opened from the Invoices table, that invoice is sorted to the top and pre-filled first, overriding oldest-first for this session only.

No unpaid invoices: the allocation list shows an empty state — No pending bills. This full amount will be kept as advance — and saving is still allowed.

Allocation is locked once saved. Changing which bills a payment settled is done only by reversing the payment and collecting again correctly (Section 11). Never provide an edit-allocation screen in this build.


# 7. Money and calculation rules


Paise everywhere: all amounts are integer paise (minor units) in the database and in calculations; rupees appear only at display and input. No floating-point balance math.

Balance derivation: a customer's dues are always derivable as: sum of invoice balances - advance held. Any cached balance column must be recomputed inside the same transaction that changes it, and must match the derivation. If code finds a mismatch, the derivation wins and the mismatch is logged.

No negative dues: dues can reach exactly zero, never below. Excess money is advance, by definition.

No negative allocation: an allocation row is always &gt; 0; rows allocated zero are not stored.

Invoice status: an invoice is Paid when its balance is 0, Part-paid when 0 &lt; paid &lt; total, and Unpaid when nothing is allocated. Statuses are derived from allocations, never typed or toggled by a user.

Rounding: input is limited to two decimals at entry, so no rounding decision exists at collection time. Do not apply bill round-off logic from the GST engine to payments.

One transaction: payment row, allocation rows, advance update, and invoice status effects are written in a single database transaction. Either everything saves or nothing does — a half-allocated payment must be impossible.

Tenant isolation: every payment, allocation, and receipt query is scoped by tenant_id, exactly like the rest of the platform. A payment can only allocate to invoices of the same customer in the same tenant; the server must reject cross-customer or cross-tenant allocation IDs.


# 8. Data model and server writes


Add the following, following existing schema conventions (tenant_id on every table, created_at / created_by, amounts in minor units with the _minor suffix). If equivalent tables already exist from earlier scaffolding, extend them instead of creating duplicates, and say so in your report.


| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Table / field | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Purpose |
| --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>payments | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>One row per collection: id, tenant_id, customer_id, receipt_number (from number series), amount_minor, mode, reference_no, payment_date, note, received_by (user id), advance_minor (unallocated part), status (posted / reversed), reversed_by, reversed_at, reversal_reason, reversal_of handled by status + a reversal entry (see below) |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>payment_allocations | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>One row per invoice settled: payment_id, invoice_id, customer_id (denormalised for safe querying), amount_minor. Unique constraint on (payment_id, invoice_id). |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>customer advance | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Advance held per customer, either as a field updated transactionally or derived as sum of payments.advance_minor minus advance consumed at checkout / later allocation. Whichever is chosen, Section 7 derivation must hold and advance use must be recorded where it is consumed. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Receipt token | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>A public token for the receipt link (Section 9), same pattern as the Step 1 bill token: unguessable, per-receipt, revocable by the existing disable-link behaviour if present. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2448"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>WhatsApp tracking fields | <w:tcPr><w:tcW w:type="dxa" w:w="7632"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>On the payment: whatsapp_send_count, whatsapp_last_sent_at, whatsapp_last_language — mirroring the invoice tracking built in Step 1. |



Receipt numbering: use the existing number-series engine with a new series for payment receipts (suggested prefix RCT-, continuing the business's chosen pattern). Numbers are gapless per series as far as the engine guarantees, never reused after reversal — a reversed receipt keeps its number and is marked Reversed.

Idempotency: the save request carries a client-generated idempotency key. A retried or double-submitted save with the same key returns the original payment instead of creating a second one.

Audit fields: every payment stores who created it and when (server time), and every reversal stores who, when, and the mandatory reason.


# 9. The receipt — print, PDF, and WhatsApp


Every collection produces a receipt. Proof of payment is what makes customers trust Khata; a collection without a receipt is a future dispute.


## Receipt success view (opens after save)


Receipt number, customer name, amount received in figures and words, mode and reference number, date and time, received by.

What it settled: list of invoices with amounts allocated, plus advance created if any.

Balance after this payment, and advance available if any.

Action buttons: Print Thermal, View A4 PDF, Send on WhatsApp, Done — mirroring the Step 1 checkout success modal so staff learn one pattern.


## Printed receipt content (thermal 58/80mm and A4)


Shop header as already configured for bills (name, address, phone, GSTIN).

Receipt number and date/time, customer name and phone.

Amount received (figures and words on A4; figures on thermal), mode, reference number if present.

Allocation summary: invoice numbers with amounts; advance line only when advance &gt; 0.

Balance after payment. Shop UPI QR is NOT printed on a collection receipt for the amount already paid; if dues remain, the A4 receipt may show the existing UPI QR labelled For remaining balance, reusing the bill QR block. Thermal: skip the QR.


## WhatsApp receipt (reuse Step 1, do not rebuild)


Channel: the same wa.me click-to-chat flow, phone normalisation, and EN / HI / TA handling from shared/whatsapp.ts. This is click-to-chat, not automatic sending — never claim a message was delivered; the UI wording stays Send on WhatsApp and, after click, Sent — Send Again, exactly as in Step 1.

Settings respect: if WhatsApp sharing is disabled in Settings, hide the WhatsApp action here too. Default language follows the Step 1 default-language setting unless the user picks another language for this send.

Receipt link: when Include Public Bill Link is enabled in Settings, include the receipt's own public link (same /b/:token-style pattern, receipt variant) so the customer can open and print the receipt without login. When disabled, send the message without a link.

Tracking: each WhatsApp click increments the payment's send count and records time and language, shown in the customer's payment history the same way invoice sends are shown (for example: WhatsApp sent x1, last 22 Oct, 2:15 pm, Tamil).

No phone on customer: the field is empty and editable in the success view; an optional Save to customer master checkbox (same pattern as Step 1) saves a typed number back to the customer record.


## Message templates (EN / HI / TA — add to shared/whatsapp.ts as a receipt template set)


English: Payment received — thank you! Receipt {receipt_no}. Amount received: Rs {amount} via {mode}. Settled: {invoice_list}. Balance remaining: Rs {balance}. Advance held: Rs {advance} (include only when advance &gt; 0). Receipt: {receipt_link} (include only when link is enabled). — {shop_name}

Hindi and Tamil templates carry exactly the same fields in the same order, translated, following the tone and structure of the existing Step 1 bill templates in shared/whatsapp.ts. Amounts show the same rounded rupee formatting used in bill messages. If {invoice_list} is long, list at most 3 invoice numbers and add +{n} more bills.

Note: The WhatsApp message must never state a balance different from the balance computed at save time. Build the message from the saved payment record, not from values typed in the modal.


# 10. Customer Detail — the Khata ledger view


A balance number alone cannot answer a customer's question. The Customer Detail view must show the full story as a statement.

Summary header: total dues, advance available, total billed to date, total collected to date, and the Collect Payment button.

Ledger table, newest first: one row per event — Invoice (number, amount, balance effect +) and Payment (receipt number, mode, amount -), plus Credit Note rows when Step 3 lands (reserve the row type now, do not build credit notes). Each row shows date, description, amount, and the running balance after that event.

Payment row actions: View Receipt (reopens the receipt view / print), Send on WhatsApp (same popover pattern as the Invoices table in Step 1), and Reverse (Owner / Manager only, Section 11).

Invoice row click: opens that invoice's existing view. Do not duplicate invoice display logic here.

Print statement: an A4 statement print for a chosen date range, reusing the A4 rendering: shop header, customer details, ledger rows, closing balance, advance line. This is what the shop hands a customer who asks enakku kanakku kaatu.

Filters: date range filter on the ledger; no other filters in this build.


# 11. Corrections — reversal only, never delete, never edit


Money records are corrected by cancelling entries, not by rewriting them. This is the same principle the execution plan sets for the whole platform, and Khata is where it matters most because customers dispute old entries.

- A posted payment cannot be edited in amount, mode, date, customer, or allocation. There is no edit screen. State this in the UI only where a user would look for it (payment row menu shows Reverse Payment, not Edit).

Reverse Payment (Owner / Manager) opens a confirm dialog showing the payment's full effect — amount, allocations per invoice, advance created — and requires a typed reason (for example: Wrong customer, Cheque bounced, Amount entered double).

On confirm, in one transaction: the payment's status becomes Reversed; its allocations are undone so each invoice's balance and status return to exactly what they were before this payment; any advance created by this payment is removed (blocked — see edge case in Section 12 — if that advance was already consumed); a reversal audit entry stores who, when, and the reason.

Reversed payments stay visible in the ledger and payment history, struck through / badged Reversed, with the reason available on view. They are excluded from all totals, balances, and reports.

To fix a wrong collection, the flow is: reverse the wrong payment, then collect a new, correct payment. The new receipt cross-references nothing automatically; the note field can mention the old receipt number.

A receipt already sent on WhatsApp cannot be unsent. If a reversed payment's receipt was shared, the receipt success / detail view shows a warning badge: Receipt was shared on WhatsApp — inform the customer, and offers Send on WhatsApp for a short correction message using the same channel (template: the correction template set: payment receipt {receipt_no} for Rs {amount} has been cancelled by {shop_name}; please ignore that receipt).


# 12. Edge cases — required behaviour



| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Case | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/><w:shd w:fill="1F3A5F" w:val="clear"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Required behaviour |
| --- | --- |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Amount is zero, negative, or empty | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Block save with an inline error on the amount field: Enter an amount greater than zero. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Amount greater than total dues | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Allowed. Excess becomes Advance. The pre-save summary and one-line confirmation show the advance amount plainly. Never silently cap the amount at dues. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Customer has no dues at all | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Allowed as a full advance, with the empty-state allocation message from Section 6. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Customer has advance already, and new dues exist | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Show existing advance in the header. Nothing is auto-applied in this modal — applying advance happens at checkout / allocation time per existing advance rules. Do not auto-net inside a new collection. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Advance from this payment was later consumed, then reversal is attempted | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Block the reversal with a clear message: This payment's advance (Rs X) was already used in bill {invoice_no}. Reverse that usage first, or contact the owner. Never allow balances to go negative to force a reversal. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Double click / double submit on Save | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Idempotency key returns the first saved payment; exactly one payment and one receipt number exist. Modal cannot be submitted twice while saving. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Two staff collect for the same customer at the same time | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Server recomputes dues and allocation validity inside the transaction. If the second payment's allocation no longer fits (bill already settled), re-run oldest-first on the remainder and inform the user after save: Bill {no} was already settled; amount applied to next dues / advance. Never over-allocate an invoice beyond its balance. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Invoice was cancelled after being listed in the modal | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>On save, cancelled invoices are excluded from allocation; their share flows to next dues or advance, with the same information message as above. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Backdated payment | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Allowed only for permitted roles (Section 4). Ledger and running balances are computed in date order, so a backdated entry re-sorts and running balances recompute. Reports count it on its payment date, and the day it was actually entered is preserved in audit fields. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Future-dated payment | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Blocked at entry with an inline error. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Save succeeds, print or WhatsApp fails | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Payment stays saved. Receipt view shows the failure plainly and offers retry. Never roll back a payment because sharing failed. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Customer has no phone number | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Collection and print work normally. WhatsApp action asks for a number in the success view, with the save-to-master option (Section 9). |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Wrong customer selected at row level | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>The modal header shows name + phone prominently before any typing, and Cancel discards cleanly. There is no move-payment-to-another-customer function — reversal + recollect is the only path. |
| <w:tcPr><w:tcW w:type="dxa" w:w="2664"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Cheque payment later bounces | <w:tcPr><w:tcW w:type="dxa" w:w="7416"/></w:tcPr><w:p><w:r/><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Handled by reversal with reason Cheque bounced. Do not build a separate bounce workflow in this step. |




# 13. Settings, reports, and dashboard impact



## Settings


No new settings card is required. Khata receipts obey the existing WhatsApp Bill Sharing settings (enable toggle, default language, include public link) — the toggle and language are platform-level sharing settings, and receipt sharing follows them. If a separate receipt-sharing toggle is trivially available in the existing settings structure, do not add it in this build; keep one sharing control.

Receipt number series prefix is configured through the existing number-series settings, like invoice prefixes.


## Reports and dashboard (existing Analytics &amp; Reports screen)


Collections today: a figure for payments collected today (by payment date, excluding reversed), visible on the reports screen alongside Revenue. Label it Khata Collections so it is never confused with sales revenue — a collection is not a new sale.

Payment-mode breakdown: the existing payment method volume breakdown must include Khata collections in the mode totals for the day, sourced from payments + checkout payments together, with reversed payments excluded. Mode totals across the platform must reconcile: cash collected today = cash at checkout today + cash Khata collections today (before shift handling lands in Step 5).

Customer dues summary: total outstanding dues across all customers, total advance held, and a simple ageing split (0-30 days, 31-60, 60+ by oldest unpaid invoice date) on the reports screen or customers screen header. Keep it to these three buckets.

Top dues list: customers sorted by dues descending, with a Collect Payment action per row, reusing the same modal.

GST reports: Khata collections do not change GST liability — tax was accounted at invoice time. Collections must NOT appear as sales in any GST report or sales register. State this in code comments where report queries are built, and cover it with a test.


# 14. Backend and API requirements


Server computes truth: dues, allocation validity, advance, and balances-after are computed on the server inside the save transaction. The frontend's live summary is a preview; if server and preview disagree, the server result is saved and returned, and the receipt shows server numbers.

Endpoints (following existing route conventions): create payment (with allocations + idempotency key), list payments for a customer (ledger), get payment / receipt detail (including public token view), reverse payment, and a customer dues summary. Name and shape them to match the existing invoices / customers routes.

Public receipt route: mirrors the public bill route's security model — token-only access, no login, read-only, shows only that receipt, and never exposes other customer data or the customer's full ledger.

Validation on the server: amount &gt; 0, date not in the future, role checks for backdate and reversal, allocation rows belong to the same customer and tenant, allocation per invoice &lt;= invoice balance at transaction time.

Performance: the customers list with balances and the ledger view must stay correct for a customer with 500+ invoices. Compute balances with set-based queries, not per-row loops.


# 15. Build order — follow this sequence


- Data first: payments and payment_allocations tables, receipt number series, advance handling, and the Section 7 derivation, with server-side balance recomputation.

Save path: create-payment endpoint with transaction, idempotency, and validation, plus the customer dues endpoint.

Modal: Collect Payment modal with header, fields, live summary, and oldest-first allocation list, wired from the Customers list and Customer Detail.

Ledger view: customer ledger with running balance, payment rows, and statement print.

Receipt: receipt success view, thermal + A4 receipt rendering, and public receipt link.

WhatsApp: receipt + correction templates in shared/whatsapp.ts, send actions in the success view and ledger, tracking fields and display.

Corrections: reversal flow with permissions, reason, blocked-advance case, and ledger display of reversed entries.

Reports: collections figure, mode-breakdown reconciliation, dues summary + ageing, top-dues list.

Entry point from Invoices: the pre-selected-invoice Collect Payment row action.

Tests: run Section 16 fully and report results test by test.


# 16. Acceptance test checklist


The feature is done only when every test below passes. Report each test as Pass or Fail with one line of evidence.

- Collect a full-dues payment in Cash: balance becomes exactly zero, all invoices show Paid, receipt number is the next in series.

Collect a part payment: balance drops by exactly that amount, oldest invoice settles first, next invoice shows Part-paid with the correct remaining balance.

Collect more than dues: excess appears as Advance in the modal summary, on the customer header, and on the receipt — dues show zero, never negative.

Collect for a customer with no dues: full amount becomes Advance; allocation empty state was shown before saving.

Manual allocation override: pay a newer bill in full while an older bill stays unpaid; ledger and invoice statuses match the manual choice.

Split-mode collection: Save &amp; Add Another records Cash then UPI as two payments with two receipt numbers; total balance effect equals the sum.

Receipt print: thermal and A4 receipts show correct amount, mode, reference, allocation list, and balance-after, matching the saved record.

WhatsApp receipt: send in EN, HI, and TA; message amounts and balance match the saved payment exactly; send count, time, and language appear in payment history.

WhatsApp with link disabled in Settings: message contains no link. With sharing toggled off: no WhatsApp action appears in modal success view or ledger.

Customer without a phone: collect and print succeed; WhatsApp action prompts for a number and save-to-master stores it on the customer.

Statement print: A4 ledger statement for a date range shows running balances that match the on-screen ledger.

Reversal by Owner: reverse a part payment; invoice balances and statuses return to exactly their pre-payment values; payment shows Reversed with reason; totals exclude it.

Reversal permission: Cashier sees no Reverse control anywhere; a direct API reversal attempt as Cashier is rejected by the server.

Reversal of advance consumed: attempt is blocked with the specified message and no balances change.

Reversal after WhatsApp share: payment view shows the shared-warning badge and offers the correction message; correction send is tracked.

Backdating: Accountant can backdate; Cashier cannot (control absent or blocked with a clear message). Ledger re-sorts and running balances recompute correctly.

Future date: blocked with an inline error; nothing is saved.

Zero / negative / empty amount: blocked with an inline error; nothing is saved.

Double submit: double-click Save and retry the same request; exactly one payment and one receipt number exist.

Concurrent collection: two sessions collect against the same oldest bill; the bill is never over-allocated, and the second user gets the information message.

Reports: Khata Collections figure equals today's posted collections; cash mode total equals checkout cash plus Khata cash for the day; reversed payments excluded everywhere.

GST safety: a day with Khata collections but no new sales shows no change in GST / sales report totals.

Ageing: dues summary buckets match a hand-checked customer set (one current, one 45-day, one 75-day oldest bill).

Tenant isolation: a payment cannot allocate to another tenant's invoice ID even when the ID is submitted directly to the API.

Advance visibility at next collection: a customer with advance shows it in the modal header and customer header consistently.

Audit trail: payment detail shows received-by user and server timestamps; reversal shows who, when, and reason.


## Must never happen


A customer's dues going below zero, or an invoice allocated more than its balance.

A payment saved without allocation rows (except a pure-advance payment, which stores advance explicitly).

A posted payment being edited or hard-deleted by any role, including Owner.

Two receipt numbers for one save, or a receipt number reused after reversal.

A WhatsApp message whose amount or balance differs from the saved payment record.

Any UI text claiming a WhatsApp message was delivered or read — only that it was sent (link opened).

A Khata collection counted as sales revenue or GST output anywhere in reports.

A payment affecting another customer's or another tenant's balances.

A failed print or WhatsApp action rolling back or hiding a saved payment.


# 17. Ready-to-paste prompt for Antigravity


Copy the block below into the Antigravity agent chat, with this spec file placed inside the project under a specs folder. It assumes the MD version of this spec; if you are handing over the docx, change only the file name in the first line.

Read the file "specs/Khata Payment Collection Spec.md" in this project and implement the Khata Payment Collection feature exactly as per the spec. Build: (1) payments and payment_allocations data model with receipt numbering from the existing number-series engine, all money in paise / minor units; (2) Collect Payment modal from Customers &amp; Khata, Customer Detail, and the Invoices table, with live balance summary and oldest-first allocation that the user can override; (3) advance handling for overpayment; (4) Customer Ledger view with running balance and A4 statement print; (5) payment receipt — thermal, A4, public receipt link, and WhatsApp send reusing the existing shared/whatsapp.ts and the Step 1 sharing settings and tracking pattern, adding receipt and correction templates in EN / HI / TA; (6) reversal-only corrections with Owner/Manager permission, mandatory reason, and the blocked case when advance was already consumed; (7) reports impact — Khata Collections figure, payment-mode reconciliation, dues ageing — collections must never count as sales or GST. Enforce everything server-side inside one transaction per save, with an idempotency key against double-posting, tenant_id scoping on every query, and RBAC exactly as the spec's permission table. Do not change the GST engine, invoice numbering logic, POS checkout flow, or Step 1 WhatsApp bill sharing. Follow the build order in the spec, run the full acceptance test checklist at the end, and report the files you changed, any new tables or fields, and the pass/fail result of each test.

End of spec. After this feature passes its checklist, the next roadmap step is Step 3: Sales Returns &amp; Credit Notes.