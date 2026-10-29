# Module 03 — Udhaar (customer credit)

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 03`.

## Owner's brief

"In India people sometimes take goods and pay later. The shopkeeper has to take note of that, so that feature as well."

## Already decided elsewhere

- Udhaar is shown prominently for kirana; hardware has large credit customers → `00` business-type table
- Unpaid part of a bill can go to udhaar automatically → draft in `02`

## Draft ideas

- Running balance per customer.
- Partial payments against the balance.
- Due dates.
- Credit limit per customer, with a warning at billing when it would be crossed.
- Overdue tracking in buckets: 30 / 60 / 90+ days.
- "Collected this week" and "who owes the most" views.
- Payment reminders that the owner approves before they go out (WhatsApp).
- The other half of credit — what the shop owes its suppliers — lives in Module 04.

## Questions to settle

- Reminders: sent only after owner approval, or automatic on a schedule?
- Interest or late fee on overdue udhaar?
- Can staff give udhaar, or only the owner? Can staff record payments?
- Printable customer statement (all bills and payments)?
- Over a credit limit: warn only, or block?

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
