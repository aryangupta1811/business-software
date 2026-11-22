# Ideas backlog

Ideas suggested by Claude in the planning chat (29 Oct 2026) that are not yet part of a module. Pick them up when planning Phase 2.

| Idea | What it is | Status |
| --- | --- | --- |
| Expense tracking | Rent, electricity, transport, so profit is real profit | Open |
| Day-end cash closing | Cash actually counted vs cash the system expects | Open |
| Customer profiles & loyalty | Customer history, loyalty points | Open |
| Report export for the CA | PDF / Excel reports | Open (also part of the zero-data-loss "export all data" proposal) |
| Data backup & export | Owner can back up and export everything | Moved to non-functional requirements in `product-overview.md` |
| Supplier & purchase management | Purchases, supplier dues | Became Module 04 |
| Patchy internet | Keep working when the internet drops | Became open question 1 (offline billing) in `product-overview.md` |
| Hindi / regional language UI | — | Decided: English and Hindi (`00` #25) |
| Commission on sales | A salary type paid on sales (which sales count, net of returns and credit notes, with or without GST) | Open (moved out of `05` at sitting 2, 2026-11-19) |
| PF and ESI deductions | Statutory deductions on salary slips | Open (out of v1, `05`, 2026-11-19) |
| Flag rule: price changed back | Flag an item whose price is lowered and raised back within a day | Open (out of v1, `06`, 2026-11-19) |
| Transliterated item search | Typing "aata" finds "आटा" at the billing counter | Open (out of v1, P1.13 design §4, 2026-11-21) |
| Weighing-scale barcodes | Labels whose barcode carries the weight or price, read at the counter | Open (out of v1, P1.13 question 11, 2026-11-21) |
| Forced password change | A staff member must choose their own password at the next login after the owner sets one | Open (out of v1, P1.5 question 7, 2026-11-21) |
| Last login on the staff list | The staff list shows when each login was last used | Open (out of v1, P1.5 design, 2026-11-21) |
| Third role (manager) | A role between owner and staff | Superseded: owner chose Owner + Staff with per-person feature switches (`00` #15–17) |

## Deferred from v1 (owner's portfolio cut, 2026-11-22)

These are **decided** features, not loose ideas: their requirements stay DECIDED in their modules (each module has a "v1 delivery" section), and their task text stays in `docs/PROGRESS.md`, marked "Deferred". Nothing about them was thrown away. Why the cut: `docs/plans/2026-11-17-fast-track.md`, section 9.

**To bring one back:** tell Claude "bring back P1.10" (or any row). Claude then: (1) adds the task to the schedule in `PROGRESS.md` and removes its "Deferred" mark; (2) changes the row's status below to "Back in, <date>"; (3) updates the module's "v1 delivery" section and Change log; (4) plans it like any task (design, your OK, tests). Rows can come back in any order unless "Needs first" says otherwise.

| Task | What it is | Decided requirements | Needs first | Size | Status |
| --- | --- | --- | --- | --- | --- |
| P1.10 Business-type stock features | Batches and expiry (soonest expiry sold first, expired stock blocked), sizes and colours, serial / IMEI with warranty, batch-wise medical costing, printing own barcode labels; turns on the "Coming later" switches (`00` #62) and the "expiring soon" alert | `01` #5–#8, #15; `00` #1; `07` #1 | — (purchase entries P2.1 then gain batch, expiry and IMEI fields) | 3–4 sessions | Deferred |
| P1.9 Excel import | Opening stock from an Excel file: preview, errors by row, import the good rows, bad rows back as Excel | `01` #17 | — | 1–2 sessions | Deferred |
| P1.11 Branch transfers & stock count | Transfers (same GSTIN: delivery challan; different GSTIN: IGST invoice and a purchase entry at the receiver) and the physical stock count | `01` #18 | P2.1 for the purchase side | 2 sessions | Deferred |
| Quotations (part of P1.17) | A quotation that later becomes a bill | `02` #9 | — | 1 session | Deferred |
| P2.2 Supplier ledger | Supplier balances, payments, purchase returns, the "supplier payments due" alert | Module 04 (DRAFT until sitting 3) | P2.1 | 2 sessions | Deferred |
| P2.6 Entry-log viewer | The viewer with filters, "watched actions", Excel export, the three flag rules and the "suspicious activity" alert; the log itself is already recorded from day one | `06` #7–#12; `07` #1 | — | 2 sessions | Deferred |
| P2.8 WhatsApp Cloud API | Sending from the app: the outbox, the 21:30 daily summary, quiet hours, templates, the weekly reminder send, PDFs attached; replaces the v1 click-to-chat links (ADR 0049) where automatic sending is needed | `07` #8–#12; `03` #15; `00` #26; ADR 0010 | Owner: Meta developer account, test number, token | 2–3 sessions | Deferred |
| Chosen ideas (D6) | The ideas the owner picks from the table above | Sitting 3, D6 | Sitting 3 | Depends on the pick | Deferred |
| DevOps stage 11 | The stretch stage in `docs/devops/DEVOPS_PLAN.md` | — | Stages 9–10 | 1–2 sessions | Deferred (was already a stretch) |
