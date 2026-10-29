# Product overview

**Status:** DECIDED, except sections marked DRAFT, PROPOSED or OPEN
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

**PROPOSED by Claude when importing — confirm in the kickoff session.**

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

## Open questions that shape the architecture

**OPEN — answer these in the kickoff session, before choosing the tech stack.**

1. **Offline billing.** If the shop's internet drops, must billing keep working?
   This is the biggest architecture decision. Offline billing means data is stored on the counter computer and synced later. That is much more complex, and syncing is exactly where data loss and stock mismatches happen.
   Options: (a) online only, (b) offline billing that syncs later, (c) online first, offline added later.
2. **WhatsApp.** The official WhatsApp Business API needs a verified business and charges per message. For a portfolio: a real integration with a test number, or a mock that shows the flow?
3. **AI assistant.** Which AI model/provider, and what monthly cost limit?
4. **Hosting budget.** How much can be spent per month? Free tiers and student credits change what's possible.
5. **Printing.** Thermal receipt printer (58/80 mm), A4 invoices, or both?
6. **Demo data.** A portfolio needs a realistic demo shop with months of sales, staff and udhaar, so the dashboard and AI have something to show. Generate it how?

## Suggested build phases

**DRAFT — finalize in the kickoff session.**

- **Phase 0 — Foundations:** tech stack, architecture, walking skeleton, Docker, CI.
- **Phase 1 — Core selling:** Modules 00, 01, 02, 03. The entry log records actions from the very first feature (Module 00 decided that every action is recorded against the logged-in person).
- **Phase 2 — Running the business:** Modules 04, 05, 06 (viewer screen), 07, 08, chosen ideas from `ideas-backlog.md`.
- **Phase 3 — AI assistant:** Module 09. It comes last because it is only as good as the data under it.
- **DevOps** is woven through every phase (see `docs/devops/DEVOPS_PLAN.md`).

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
