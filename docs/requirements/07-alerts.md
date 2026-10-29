# Module 07 — Alerts

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 07`.

## Owner's brief

"It should give alerts to the owner and staff both that a particular item is short in inventory."

## Already decided elsewhere

- Owner alerts are sent on WhatsApp → `00` #26
- No phone app, so without WhatsApp the owner sees alerts only when someone opens the software → `00` #23
- Low-stock level is set per item, per branch → `01` #1
- Medical has expiry alerts on by default → `00` business-type table

## Draft ideas

- Alert types: low / out of stock, expiring soon, overdue udhaar, supplier payments due, suspicious activity (from Module 06), absent staff.
- Who gets what: staff get stock alerts; only the owner gets money alerts.
- A daily closing summary sent to the owner on WhatsApp.
- In-app alerts on the counter screen.
- Group alerts together so people don't start ignoring them.

## Questions to settle

- WhatsApp approach for the portfolio: real integration or mock (see open question 2 in `product-overview.md`).
- Quiet hours (no WhatsApp messages at night)?
- Which alerts can the owner turn off?
- What time is the daily summary sent?

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
