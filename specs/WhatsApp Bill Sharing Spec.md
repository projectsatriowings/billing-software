# WhatsApp Bill Sharing Spec

**Billing Platform — Feature Specification**
Checkout success modal + invoice resend

> This document tells the build team exactly what to build, where each element goes, what happens on every click, and how to test it. A developer can implement the feature without a follow-up meeting, and a tester can verify it line by line.
>
> **For AI builders (Antigravity / coding agents):** Read this entire file first, then implement it exactly as written. Follow the build order in Section 10, run the test checklist in Section 11, and report the files you changed and the test results. Do not rewrite `shared/whatsapp.ts` — use it. Do not change the GST engine or invoice numbering logic.

| Item | Detail |
| --- | --- |
| Feature | WhatsApp Bill Sharing — Step 1 of the daily-loop roadmap |
| Priority | P0 — build first, before Khata payments, returns, purchases, and shifts |
| Surfaces | POS checkout success modal (new) + Bills & Invoices table (resend action) + Settings (defaults) |
| Already built | `shared/whatsapp.ts` — phone normalisation, EN / HI / TA message templates, wa.me link generation |
| Phase 1 method | wa.me click-to-chat. No WhatsApp Business API, no per-message cost, no Meta approval wait |
| Depends on | Completed invoice (existing), customer phone on the bill (existing), thermal + A4 rendering (existing) |
| Out of Phase 1 | Automatic sending, WhatsApp Business API, payment collection on WhatsApp, marketing broadcasts |

> **How to read this spec:** Sections 1–3 are the decision record — what and why. Sections 4–8 are the build instructions — screens, buttons, rules, and messages. Sections 9–11 are tracking, settings, and the test checklist. Do not skip Section 7 (edge cases): WhatsApp sharing must never block billing.

## 1. Purpose — the bill is finished, but the customer has nothing

The platform already creates a correct GST bill in seconds. Today that bill then stops inside the shop: it can be printed, but the customer standing at the counter — who expects every bill on WhatsApp — gets no copy unless the cashier manually types the number into their own phone.

WhatsApp sharing closes that gap in one click from the same screen where the bill was just created. It is the first of six steps that close the daily shop loop (bill, share, collect khata, handle returns, bring stock in, tally the day), and it is first for three reasons:

- **It is the most visible feature.** Customers see it on every single bill, unlike back-office screens only the owner opens.
- **The hard part already exists.** Message templates in English, Hindi, and Tamil, phone normalisation, and wa.me link generation are built in `shared/whatsapp.ts`. This step is wiring, not invention — the smallest build with the largest visible effect.
- **It creates the habit.** A shop that sends every bill on WhatsApp from day one will not go back to a competitor that does not.

Success looks like this: bill completes, success modal opens, cashier taps one green button, WhatsApp opens with the customer's number and a ready message, cashier taps Send in WhatsApp, and is back at a fresh POS screen in under ten seconds — without typing a number or a message even once.

## 2. Current state — what exists and what is missing

| Piece | State | Source |
| --- | --- | --- |
| Phone normalisation | Built — handles spaces, +91, leading 0 | `shared/whatsapp.ts` |
| Message templates (EN / HI / TA) | Built — localised text with invoice placeholders | `shared/whatsapp.ts` |
| wa.me link generation | Built — click-to-chat URL from phone + message | `shared/whatsapp.ts` |
| Checkout success modal | Missing — checkout ends with no share step | To build (Section 4) |
| WhatsApp button on Invoices | Missing — no resend from bill history | To build (Section 5) |
| Send tracking on the invoice | Missing — no record of a share | To build (Section 9) |
| WhatsApp defaults in Settings | Missing — no language / toggle defaults | To build (Section 9) |

Nothing in this feature requires a new invoice, tax, or printing change. If implementation appears to need one, stop — that is a scope error, not a requirement.

## 3. Scope

### In scope — Phase 1

- Checkout success modal after every completed bill, with Print Thermal, Send on WhatsApp, and View A4 PDF actions.
- One-click WhatsApp share from the modal using the phone number already on the bill.
- WhatsApp resend action on every row of the Bills & Invoices table.
- Language selection per send (English / Hindi / Tamil), defaulting from Settings.
- Phone number validation and inline correction inside the modal when the number is missing or invalid.
- Send tracking: timestamp, destination number, language, and sending user recorded on the invoice.
- Settings: enable/disable WhatsApp sharing, default language, and whether the message includes the bill link placeholder.

### Out of scope — do not build in Phase 1

- **WhatsApp Business API (official API).** It adds Meta verification, template approval, and per-conversation cost. Revisit only in Phase 2, if shops ask for fully automatic sending without opening WhatsApp.
- **Automatic sending.** Phase 1 always opens WhatsApp for the cashier to confirm and send. No silent or background sends.
- **PDF attachment inside WhatsApp.** wa.me cannot attach files. The message carries bill details and, where a hosted bill link is available, the link. True PDF attachment is a Phase 2 (Business API) capability — see Section 8.
- **Broadcasts, offers, and marketing messages.** This feature sends a bill to the customer who just bought. Nothing else.
- **Payment requests and khata reminders.** Those belong to Step 2 (Khata payment collection) and get their own spec.

## 4. The checkout success modal — primary surface

The modal is the heart of this feature. It appears once, immediately after a bill is saved, and it is the only new screen most cashiers will ever interact with.

### 4.1 Trigger and dismissal

- **Trigger:** the instant an invoice is successfully saved from POS checkout (including Restaurant KOT bills, after the bill — not the KOT — is finalised).
- **Never on failure:** if invoice save fails, show the existing error flow only. No modal, no share option for an unsaved bill.
- **Dismissal:** the Close (×) button, the "New Bill" button, pressing Esc, or completing/skipping all actions and tapping Done. Dismissing never undoes the bill.
- **One modal per bill:** reprinting or resending later happens from the Invoices table (Section 5), not by reopening this modal.
- **Focus and keyboard:** modal traps focus on open; Enter does not auto-send WhatsApp (sending is always a deliberate click).

### 4.2 Layout — top to bottom

| Zone | Content |
| --- | --- |
| Header | Green tick icon + "Bill created" + invoice number (e.g. SKM-1001) |
| Summary line | Customer name (or "Walk-in"), item count, grand total in bold |
| Balance line | Amount paid and balance / khata due — shown only when balance > 0 |
| WhatsApp block | Phone field (pre-filled), language selector, green Send button — see 4.3 |
| Other actions | Print Thermal Slip • View A4 GST PDF |
| Footer | "New Bill" (primary, returns to a fresh POS cart) • Close (× in header) |

Keep the modal to one column and one screen on a phone-width viewport. If an element does not fit that rule, it does not belong in this modal.

### 4.3 The WhatsApp block — exact behaviour

1. **Pre-fill.** Phone field is filled from the customer record on the bill. For a walk-in with no customer, the field is empty with the placeholder "Customer mobile number".
2. **Language.** A compact selector — English / हिन्दी / தமிழ் — set to the Settings default. Changing it changes only this send, not the default.
3. **Send button.** Label: "Send Bill on WhatsApp", WhatsApp green, full width of the block. It is enabled only when the phone field holds a valid number (Section 6).
4. **On click.** Build the message from the template (Section 8), record the send attempt (Section 9), then open the wa.me link — WhatsApp app on mobile, WhatsApp Web in a new tab on desktop.
5. **After return.** The modal stays open with the button state changed to "Sent — Send Again". The cashier finishes with New Bill or Close. Never auto-close: the cashier may still need to print.
6. **Inline error.** An invalid number shows a red hint directly under the field ("Enter a valid 10-digit mobile number") and the Send button stays disabled. No popup, no page reload.

> **Rule that overrides everything in this section:** WhatsApp is optional, billing is not. A missing phone, an invalid number, or WhatsApp not installed must never block printing, closing the modal, or starting the next bill.

## 5. Resend from Bills & Invoices

Customers ask for their bill again hours or days later. The cashier must be able to resend it in under fifteen seconds without reopening the bill.

- **Placement:** a WhatsApp icon button in the Actions column of every invoice row, beside the existing Thermal preview and A4 PDF actions.
- **On click:** a compact popover (not the full checkout modal) showing the customer phone (editable), the language selector, and a Send button — same validation and template rules as Section 4.3.
- **Eligible bills:** all completed invoices, including khata / part-paid bills (the message then shows the balance due — Section 8). Cancelled or voided bills show the button disabled with the tooltip "Bill cancelled". Credit notes are excluded in Phase 1.
- **Tracking:** a resend updates the same send record fields as a first send and increments the send count, so the invoice history shows "WhatsApp sent ×2, last at 4:32 pm".
- **No phone on record:** the popover opens with an empty phone field; entering a number here does not silently edit the customer master. Offer a separate, explicit "Save to customer" tickbox, unticked by default.

## 6. Phone number rules

Most failed sends are failed numbers. Apply these rules in the frontend for instant feedback and again in `shared/whatsapp.ts` normalisation before the wa.me link is built — never trust the field alone.

| Input the cashier types | Normalised result | Valid? |
| --- | --- | --- |
| `98765 43210` | +91 98765 43210 → `wa.me/919876543210` | Yes |
| `+91 98765 43210` | `wa.me/919876543210` | Yes |
| `098765 43210` | Leading 0 stripped → `wa.me/919876543210` | Yes |
| `919876543210` | `wa.me/919876543210` | Yes |
| `98765` (landline / short) | Fewer than 10 digits | No — inline error |
| `abcdefghij` | Non-numeric after cleaning | No — inline error |

- **Default country:** India (+91) when no country code is present. Do not add a country picker in Phase 1.
- **Cleaning:** strip spaces, dashes, and brackets; allow one leading +; strip a single leading 0 from a 10-digit national number.
- **Validation:** after cleaning, the national number must be exactly 10 digits. Anything else disables Send and shows the inline hint.
- **Privacy:** the number is used only to open WhatsApp for this bill. It is never sent to a server-side messaging service in Phase 1, because wa.me opens on the cashier's own device.

## 7. Edge cases — what must happen when things are not perfect

| Case | Required behaviour |
| --- | --- |
| Walk-in, no phone | Modal opens normally; WhatsApp block shows empty field. Print and New Bill work as usual. |
| Customer declines to share a number | Cashier skips WhatsApp. No prompt, no warning, no record against the customer. |
| Invalid number typed | Send stays disabled with inline hint until corrected. No wa.me link is ever built from an invalid number. |
| WhatsApp not installed (mobile) | The wa.me link offers WhatsApp Web / store fallback by itself. The app does not detect or handle this. |
| Desktop, no WhatsApp Web login | Link opens WhatsApp Web login in a new tab; the billing tab and modal are untouched. |
| Part-paid / khata bill | Message includes the balance-due line. Fully paid bills omit it entirely — no "Balance: ₹0" line. |
| Bill with discount | Message shows the final grand total the customer actually pays, after discount and GST — never the pre-discount subtotal. |
| Very long bill (50+ items) | Message stays summary-only (Section 8). Never paste all line items into the chat text. |
| Double-click on Send | Second click is ignored while the first is in flight; the send is recorded once. |
| Internet drops after bill save | Modal and Print still work (bill is saved). WhatsApp opening may fail on the device — cashier can resend later from Invoices. |

## 8. Message templates — English, Hindi, Tamil

One template per language, identical structure, identical placeholders. The templates already exist in `shared/whatsapp.ts` — this section fixes what they must contain, not their exact wording, which the existing file governs.

### 8.1 Placeholders (same in all three languages)

| Placeholder | Filled from | Example |
| --- | --- | --- |
| `{store_name}` | Business profile | Sri Kumaran Stores |
| `{invoice_number}` | Saved invoice | SKM-1001 |
| `{invoice_date}` | Saved invoice | 22 Oct 2026 |
| `{total_amount}` | Invoice grand total | ₹1,240 |
| `{balance_due}` | Invoice balance (only if > 0) | ₹500 |
| `{bill_link}` | Hosted bill link, if enabled & available | Short link to the bill page |

### 8.2 Message shape (English shown; Hindi and Tamil follow the same lines)

```text
Namaste! Your bill from {store_name} is ready.

Bill No: {invoice_number}  •  Date: {invoice_date}
Total: {total_amount}
Balance due: {balance_due}        <- include only when balance > 0
View your bill: {bill_link}       <- include only when a link is available

Thank you for shopping with us!
```

- **Summary only.** The message carries the bill header and total, not the item list. The full bill lives in the printout and the A4 PDF.
- **Amounts formatted as the bill formats them:** Indian number grouping, ₹ symbol, round-off applied exactly as on the printed invoice. The WhatsApp total and the printed total must never differ by even one paisa.
- **Bill link honesty:** if no hosted bill link exists yet, the `{bill_link}` line is omitted completely. Never send a placeholder, a dead link, or a link to a login page the customer cannot open.
- **No promotional line.** No offers, no "follow us", no extra links in Phase 1.

## 9. Settings, permissions, and send tracking

### 9.1 Settings (Business Settings → Bill Sharing)

| Setting | Default | Effect |
| --- | --- | --- |
| Enable WhatsApp sharing | On | Off hides the WhatsApp block and the Invoices resend button everywhere |
| Default message language | English | Pre-selected language in the modal and the resend popover |
| Include bill link in message | Off | On adds the `{bill_link}` line when a hosted link is available |

### 9.2 Permissions (RBAC)

| Role | Send / resend | Change WhatsApp settings |
| --- | --- | --- |
| Owner | Yes | Yes |
| Manager | Yes | No |
| Cashier | Yes | No |
| Accountant | Yes (from Invoices) | No |

Sending is a counter action, so every operational role can send. Settings stay with the Owner, matching how the rest of the platform treats configuration.

### 9.3 Send tracking — fields to record on the invoice

| Field | Meaning |
| --- | --- |
| `whatsapp_send_count` | Number of times this bill was shared (first send + resends) |
| `whatsapp_last_sent_at` | Timestamp of the most recent share |
| `whatsapp_last_sent_to` | Normalised number the most recent share went to |
| `whatsapp_last_language` | Language of the most recent share (en / hi / ta) |
| `whatsapp_last_sent_by` | User who performed the most recent share |

- Record the share when the cashier clicks Send and the wa.me link is opened. Phase 1 cannot confirm delivery inside WhatsApp — label the UI state "Sent" as "Opened in WhatsApp" in any detailed history view, and never claim "Delivered" or "Read".
- Show the tracking line in the invoice detail / history: "WhatsApp sent ×2 • last 22 Oct, 4:32 pm • Tamil". Show nothing when a bill was never shared.
- Tracking is per tenant, under the same `tenant_id` isolation as every other record. A share record must never be visible across businesses.

## 10. Build steps — in this order

1. **Checkout modal shell.** Build the success modal with summary, Print, and A4 actions first; verify billing flow is unchanged without WhatsApp.
2. **Wire the WhatsApp block.** Pre-fill phone, language selector, validation (Section 6), and wa.me opening via the existing `shared/whatsapp.ts` functions. Do not rewrite the templates or normalisation.
3. **Send tracking.** Add the fields in 9.3, record on click, show the tracking line in invoice history.
4. **Invoices resend.** Add the row action and popover from Section 5, reusing the same validation, template, and tracking code as the modal — one code path, two entry points.
5. **Settings.** Add the three settings in 9.1 and honour them in both entry points.
6. **Test.** Run the full checklist in Section 11 on Android, iOS, and desktop before calling this step done.

> **Definition of done for Step 1:** a cashier can complete a bill, send it on WhatsApp in the customer's language, print it, and start the next bill — and do the whole cycle again for a walk-in with no phone number — with no developer in the room.

## 11. Test checklist

Tick every box. Any failure in the "must never happen" group at the end blocks release, even if everything else passes.

### 11.1 Checkout modal — functional

- [ ] Modal opens after a successful bill save, showing the correct invoice number, customer, item count, and total.
- [ ] Modal does not open when invoice save fails.
- [ ] Print Thermal prints the same bill from the modal; A4 PDF opens the correct invoice.
- [ ] New Bill closes the modal and presents an empty cart; the previous cart does not leak into it.
- [ ] Esc and Close dismiss the modal without affecting the saved bill.
- [ ] Restaurant flow: modal appears after the final bill, not after the KOT.

### 11.2 WhatsApp send — functional

- [ ] Phone is pre-filled for a saved customer; empty with the correct placeholder for a walk-in.
- [ ] Send opens WhatsApp (app on mobile, Web in a new tab on desktop) with the number and the fully filled message.
- [ ] Message total matches the printed bill exactly, including discount, GST, and round-off.
- [ ] Balance line appears on a part-paid bill and is absent on a fully paid bill.
- [ ] After sending, the button reads "Sent — Send Again" and a second send works.
- [ ] Rapid double-click records and opens only one send.
- [ ] All six phone formats in Section 6 behave exactly as the table specifies.

### 11.3 Languages

- [ ] English, Hindi, and Tamil each render a complete message with every placeholder filled — no raw `{placeholder}` text ever reaches WhatsApp.
- [ ] Hindi and Tamil text displays correctly (no boxes or broken characters) on Android, iOS, and WhatsApp Web.
- [ ] Changing the language in the modal changes only that send; the Settings default is unchanged.
- [ ] The Settings default language is pre-selected on the next bill.

### 11.4 Resend, settings, and tracking

- [ ] Resend popover works from the Invoices table for paid, part-paid, and khata bills.
- [ ] Resend button is disabled on a cancelled bill, with the correct tooltip.
- [ ] A resend to a typed-in number does not alter the customer master unless "Save to customer" is ticked.
- [ ] Send count, last-sent time, number, language, and user are recorded and shown in invoice history.
- [ ] Disabling WhatsApp sharing in Settings hides both entry points immediately.
- [ ] Cashier and Manager can send but cannot open WhatsApp settings; Owner can.
- [ ] No share record or bill from one business is visible to another business (tenant isolation).

### 11.5 Must never happen — release blockers

- [ ] Billing is never blocked by a missing phone, an invalid phone, or WhatsApp being unavailable.
- [ ] A message is never sent automatically or in the background.
- [ ] A message never shows a wrong total, a raw placeholder, a dead bill link, or another customer's details.
- [ ] The UI never claims "Delivered" or "Read" for a Phase 1 wa.me share.

---

## Copy-paste prompt for Antigravity

Paste this into the Antigravity agent chat, with this file placed inside the project (for example in a `specs/` folder):

```text
Read the file "specs/WhatsApp Bill Sharing Spec.md" in this project and implement the WhatsApp Bill Sharing feature exactly as per the spec. Build: (1) checkout success modal with Print Thermal, Send on WhatsApp, and View A4 PDF buttons, (2) WhatsApp resend button on the Invoices table. Use the existing shared/whatsapp.ts for phone normalisation and the English/Hindi/Tamil message templates, do not rewrite it. Follow all phone rules and edge cases in the spec. WhatsApp failure must never block billing. Do not change the GST engine or invoice numbering logic. Follow the build order in the spec, run the test checklist at the end, and report the files you changed and the test results.
```

*When every box above is ticked, Step 1 is complete and the roadmap moves to Step 2 — Khata payment collection. That feature gets its own spec, written the same way: screen, buttons, click behaviour, and tests, before any code.*
