# Requirements

Imported from the planning chat on claude.ai (29 Oct 2026). **This folder is now the single source of truth.** The claude.ai doc "Business Software – Requirements" is an archive.

## Status

| # | Module | Status | File |
| --- | --- | --- | --- |
| — | Product overview (brief, scope, non-functional requirements, architecture questions) | DECIDED (2026-10-29 kickoff) | `product-overview.md` |
| 00 | Business setup, users & roles | DECIDED | `00-business-setup-users-roles.md` |
| 01 | Items & inventory | DECIDED (open questions answered 2026-11-17) | `01-items-inventory.md` |
| 02 | Billing & GST | DECIDED (2026-11-17) | `02-billing-gst.md` |
| 03 | Udhaar (customer credit) | DECIDED (2026-11-17) | `03-udhaar.md` |
| 04 | Suppliers & purchases | DRAFT | `04-suppliers-purchases.md` |
| 05 | Staff, attendance & salary | DECIDED (2026-11-19) | `05-staff-attendance-salary.md` |
| 06 | Entry logs | DECIDED (2026-11-19) | `06-entry-logs.md` |
| 07 | Alerts | DECIDED (2026-11-19) | `07-alerts.md` |
| 08 | Dashboard | DRAFT | `08-dashboard.md` |
| 09 | AI assistant | DRAFT | `09-ai-assistant.md` |
| — | Ideas not yet placed | Backlog | `ideas-backlog.md` |

## What the labels mean

- **DECIDED** — the owner confirmed it. Change only with the owner's OK, and add a line to the file's Change log.
- **DRAFT** — ideas from the planning chat, mostly suggested by Claude and not confirmed. Run `/finalize-module NN` before building.
- **Proposed by Claude** — a point Claude added that the owner hasn't confirmed yet. Confirm when convenient.
- **OPEN / Open question** — nobody has decided. Must be answered before building the part it affects.

## References between files

`00` #11 means file `00-…`, point 11. Module numbers match the planning chat ("Module 0", "Module 1", …).
