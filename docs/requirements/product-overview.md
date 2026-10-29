# Product overview

**Status:** DECIDED (non-functional requirements confirmed and architecture questions answered in the kickoff session, 2026-10-29)
**Source:** planning chat on claude.ai, 29 Oct 2026

## In one line

One app that runs an Indian product-selling business end to end: GST billing, inventory, udhaar (customer credit), suppliers, staff attendance and salary, entry logs, alerts, a dashboard and an AI assistant.

## Why this project exists

- It is the owner's portfolio project for campus placements.
- It is also the project the owner uses to learn DevOps and cloud (see `docs/devops/DEVOPS_PLAN.md`).
- It is not built for one real shop. It must work for any business that sells products, and it must look and behave like a real product.

## The owner's original brief (29 Oct 2026)

These are the owner's own words, lightly cleaned up. Everything else in this folder grew out of them.

1. **Staff attendance log**, with staff salary slips. Staff sometimes take an advance. There must be a way to enter the advance amount so the app recalculates how much money the staff member still has to return.
2. **Inventory management.**
3. **Billing system** with GST number and all details.
4. **Pay later (udhaar).** In India people sometimes take goods and pay later. The shopkeeper has to record that.
5. **An AI chatbot** that answers anything asked about the data, for example:
   - "Which item sold the most this month?"
   - "Who was our top customer this month, and which item did he buy most?"
   - "How many holidays has Rahul taken this month so far?"
   The owner asked to think deeply about every possible question it should answer.
6. **Entry logs.** Everything every staff member enters in the system shows in a log for the owner to review.
7. **Business dashboard** with the main highlights, such as total revenue and employees present today, plus more.
8. **Alerts** to both owner and staff when an item is running short in inventory.

- **Two login modes:** owner and staff. Many things are hidden from staff, such as staff salaries and profit numbers.
- More features will be added in the future.

## Scope decisions

Full detail is in `00-business-setup-users-roles.md`. Summary:

- **Who it's for:** any business that **sells products**. Service items (repair charge, delivery fee) can also be billed.
- **Out of scope for v1:** restaurants, salons, clinics and other appointment- or table-based businesses.
- **Business types in v1:** Kirana/grocery, Medical, Clothing/footwear, Electronics/mobile, Hardware. More later.
- **Many businesses can sign up.** Each sees only its own data. One owner can run several branches.
- **Where it's used:** a counter computer at the shop. **No phone use.**
- **No super-admin panel** in v1.
- **Languages:** English and Hindi.
- **Owner alerts:** sent on WhatsApp.

## How it is used at the shop

- A counter computer with keyboard, barcode scanner and receipt printer.
- Billing must be fast with keyboard and scanner alone.
- Several counters can bill at the same time.
- Staff share the counter computer, but each staff member with access logs in with their own ID.

## Market context (Claude's research, 29 Oct 2026)

- Vyapar, myBillBook and Khatabook already cover GST billing, inventory, receivables and udhaar for Indian small businesses.
- AI assistants for shop billing also exist: student projects with Hinglish voice, and WhatsApp-based tools such as Khata Bhai.
- So the feature list alone is not unique. **The edge has to be depth:** staff + advances + udhaar + permissions + an AI that is accurate and respects permissions, all in one app, well built.
- A few polished modules beat many half-built ones.

## Non-functional requirements

**DECIDED 2026-10-29.** Proposed by Claude when importing, confirmed by the owner in the kickoff session, with measurable targets added below.

1. **Zero data loss (top priority).**
   - Business records are never hard-deleted: bills, payments, stock movements, udhaar entries, attendance, salary. Mistakes are fixed by cancelling or reversing, with a reason.
   - A bill, its stock deduction and its udhaar entry are saved together or not at all. A half-saved bill must be impossible.
   - Every change is recorded in the entry log (who, what, when, old value → new value).
   - Automatic backups, with a restore that has actually been tested. An untested backup doesn't count.
   - The owner can export all their data (Excel/PDF).
2. **Data separation.** One business can never see another's data. A staff member sees only what the owner allowed.
3. **Correct with several counters.** If two counters sell the last unit at the same moment, stock must not go wrong silently.
4. **Exact money.** All amounts are exact to the paisa, with GST rounding done the way the rules require.
5. **Fast billing.** A normal bill should take seconds at the counter.
6. **Security.** Passwords, owner auto-lock, owner password for permission changes.
7. **English and Hindi** throughout the app.

**Measurable targets** (added 2026-10-29):

- Max data lost in a disaster (RPO): **5 minutes**. Max time to recover (RTO): **1 hour**. Checked by a monthly restore drill.
- The database itself refuses to delete business records, and the entry log is append-only (ADR 0007).
- A bill is never saved twice, even if the network drops mid-save (ADRs 0001, 0007).
- Money is stored as whole paise; no floating-point numbers (ADR 0008).
- A scanned item appears on the bill in **under 200 ms**; a bill saves in **under 1 second**.
- Security: HTTPS everywhere, Argon2id password hashing, rate-limited logins, no secrets in git (ADR 0009).

## Open questions that shape the architecture

**ANSWERED 2026-10-29** in the kickoff session. Each answer links its ADR in `docs/decisions/`.

1. **Offline billing.** If the shop's internet drops, must billing keep working?
   This is the biggest architecture decision. Offline billing means data is stored on the counter computer and synced later. That is much more complex, and syncing is exactly where data loss and stock mismatches happen.
   Options: (a) online only, (b) offline billing that syncs later, (c) online first, offline added later.
   **Answer:** (c) online first, confirmed by the owner ("v1 runs online"). v1 needs internet; a dropped connection never loses or duplicates a bill; the data is designed so offline can be added later. → ADR 0001
2. **WhatsApp.** The official WhatsApp Business API needs a verified business and charges per message. For a portfolio: a real integration with a test number, or a mock that shows the flow?
   **Answer:** a real WhatsApp Cloud API integration using Meta's free test number, sent through an outbox, plus an in-app Outbox page and a log-only sender for local use. → ADR 0010
3. **AI assistant.** Which AI model/provider, and what monthly cost limit?
   **Answer:** the Claude API (owner's choice), answering only through permission-checked tools. The model and monthly cap are chosen at the start of Phase 3. A Claude subscription does not include API access: the app needs a Claude Console API key, billed separately. → ADR 0015
4. **Hosting budget.** How much can be spent per month? Free tiers and student credits change what's possible.
   **Answer:** ₹0 (owner, 2026-10-29). Everything runs locally until the cloud stage in Phase 1. Then an AWS Free plan account (up to $200 credits over 6 months, no charges possible), timed to placement season, running one EC2 server + RDS. The only cost that can't be zero is a few dollars of Claude API credit in Phase 3. → ADRs 0011, 0015
5. **Printing.** Thermal receipt printer (58/80 mm), A4 invoices, or both?
   **Answer:** both: an 80 mm receipt (58 mm as a setting) and A4, printed from the browser with kiosk printing; PDFs rendered by headless Chromium so Hindi displays correctly. → ADR 0014
6. **Demo data.** A portfolio needs a realistic demo shop with months of sales, staff and udhaar, so the dashboard and AI have something to show. Generate it how?
   **Answer:** a seed script with a fixed random seed that runs through the app's own services, starting at the end of Phase 1, plus a one-click demo login. → ADR 0016

## Suggested build phases

**DECIDED 2026-10-29.** Session-sized tasks, with the DevOps stages woven in, are in `docs/PROGRESS.md`.

- **Phase 0 — Foundations:** tech stack, architecture, walking skeleton, Docker, CI.
- **Phase 1 — Core selling:** Modules 00, 01, 02, 03. The entry log records actions from the very first feature (Module 00 decided that every action is recorded against the logged-in person).
- **Phase 2 — Running the business:** Modules 04, 05, 06 (viewer screen), 07, 08, chosen ideas from `ideas-backlog.md`.
- **Phase 3 — AI assistant:** Module 09. It comes last because it is only as good as the data under it.
- **DevOps** is woven through every phase (see `docs/devops/DEVOPS_PLAN.md`).
- **Demo data** starts at the end of Phase 1 and grows each phase, so the dashboard and AI are built on realistic numbers (ADR 0016).

## Glossary

| Term | Meaning |
| --- | --- |
| Udhaar | Credit given to a customer: take goods now, pay later |
| Kirana | Neighbourhood grocery / general store |
| GST | Goods and Services Tax |
| GSTIN | A business's 15-character GST registration number |
| HSN code | Product classification code used on GST invoices |
| CGST + SGST | Central + State GST, charged on sales within the same state |
| IGST | Integrated GST, charged on sales to another state |
| Composition scheme | Simplified GST scheme for small businesses; they issue a "bill of supply" and don't show tax separately |
| B2B / B2C | Sale to a GST-registered business (customer GSTIN on bill) / sale to a consumer |
| Credit note | Document that reverses all or part of a bill, e.g. for a return |
| MRP | Maximum Retail Price printed on packaged goods; selling above it is illegal |
| FSSAI number | Food licence number, shown on bills of food businesses |
| Drug licence number | Licence number a medical shop shows on its bills |
| IMEI | Unique number of each mobile phone |
| Batch | A group of stock bought together, with its own expiry date and cost |
| Average cost | Profit is calculated using the average purchase price of the stock |
| Financial year | April to March in India; invoice numbering restarts every April |

## Change log

- 2026-10-29 — Created from the planning chat on claude.ai.
- 2026-10-29 — Kickoff session: non-functional requirements confirmed, with measurable targets; the six architecture questions answered (ADRs 0001, 0010, 0011, 0014, 0015, 0016); build phases decided, with demo data starting at the end of Phase 1.
- 2026-10-29 — Owner: hosting budget is ₹0 (AWS Free plan), not the ₹1,000/month first proposed; v1 runs online. ADR 0011 redesigned before it was committed.
