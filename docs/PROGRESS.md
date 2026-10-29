# Progress

**Current focus:** Phase 0 — choose the tech stack and architecture
**Next step:** Kickoff session (prompt in `START_HERE.md`)
**Last updated:** 2026-10-29

## Requirements status

| Module | Status |
| --- | --- |
| Product overview | DECIDED (non-functional requirements PROPOSED, architecture questions OPEN) |
| 00 Business setup, users & roles | DECIDED |
| 01 Items & inventory | DECIDED |
| 02 Billing & GST | DRAFT |
| 03 Udhaar | DRAFT |
| 04 Suppliers & purchases | DRAFT |
| 05 Staff, attendance & salary | DRAFT |
| 06 Entry logs | DRAFT |
| 07 Alerts | DRAFT |
| 08 Dashboard | DRAFT |
| 09 AI assistant | DRAFT |

## Phase 0 — Foundations

- [x] Requirements for Modules 00 and 01 decided (planning chat, 2026-10-29)
- [ ] Confirm the non-functional requirements in `product-overview.md`
- [ ] Answer the open architecture questions in `product-overview.md`
- [ ] Choose the tech stack (one ADR per decision)
- [ ] Write `docs/architecture.md` with a simple diagram
- [ ] Break Phases 1–3 below into tasks small enough for one session each
- [ ] Walking skeleton: one screen + one API call + database, running in Docker, CI on every push (DevOps stages 1–3)

## Phase 1 — Core selling (draft order; confirm in Phase 0)

- [ ] Finalize Modules 02 and 03 (`/finalize-module`)
- [ ] Module 00 — signup, business types, users, roles, permissions, auto-lock
- [ ] Entry log recording from the first feature (Module 06, recording only)
- [ ] Module 01 — items & inventory
- [ ] Module 02 — billing & GST
- [ ] Module 03 — udhaar
- [ ] DevOps stages 4–7 (cloud, Terraform, deployment, backups)

## Phase 2 — Running the business

- [ ] Finalize Modules 04–08
- [ ] Module 04 — suppliers & purchases
- [ ] Module 05 — staff, attendance & salary
- [ ] Module 06 — entry log viewer and flags
- [ ] Module 07 — alerts (WhatsApp)
- [ ] Module 08 — dashboard
- [ ] Chosen ideas from `ideas-backlog.md`
- [ ] DevOps stages 9–10

## Phase 3 — AI assistant

- [ ] Finalize Module 09
- [ ] Module 09 — AI assistant
- [ ] Demo data for the portfolio
- [ ] DevOps stage 11 (stretch)
