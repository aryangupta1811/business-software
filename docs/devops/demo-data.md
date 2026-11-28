# Demo data: building and resetting the demo shop

The public demo is one shared kirana shop that a visitor opens with a click ("Try as the owner" or "Try as a cashier"). Decisions: ADR 0016 and its dated note of 2026-11-24 (owner's decision D5). Code: `apps/api/src/demo/`. Task: P1.20.

## What the seed makes

`Demo Kirana Store`, a fictional shop in Pune, built **only through the API's own routes**, so every rule the real counter has was applied: stock equals its movements, invoice numbers have no gaps, GST is the engine's, udhaar balances equal their ledger, and every bill has its log entry.

| What | How much |
| --- | --- |
| Items | 31 goods (GST 0, 5, 18 and 40 %, HSN codes, MRPs, Hindi names, packs such as a 25 kg bag, a box of 48, a dozen, barcodes `DM001`...) in 9 categories, plus a delivery service |
| Opening stock | on the first day, sized so that 5 items end the history low and 1 is out of stock |
| Bills | 42 days of history ending **yesterday** (Indian time), about 1,450 bills: busier weekends, a Diwali week at twice the normal rate, morning and evening rushes, cash / UPI / card / split / udhaar |
| Customers | 12, plus a tiffin centre with a (made-up) GSTIN that gets tax invoices; 6 owe udhaar, 2 of them overdue; regular ones pay part every 10 to 16 days; one has an opening balance from "the old notebook" |
| Staff | the owner, a cashier with a login (`cashier`), and a helper with no login; the cashier has the usual switches and is off on Sundays |
| Stock changes | a few write-offs (expired bread, wet biscuits) and a recount |

Everything is fictional. Brands are invented. **Every phone number starts with `1`**, which no Indian mobile number does, so a WhatsApp link opens no real chat (D5). Passwords are the public `DEMO_PASSWORD` in `packages/shared/src/auth.ts`, shown in the demo banner (the lock screen and the owner's-OK boxes ask for one).

The same seed gives the same shop: a fixed random seed (`20261124`) and the history ending on the day before the run.

### How old history is made (P1.20 (c))

The API runs inside the seed process with a clock the seed sets (`CLOCK`, the token every service already reads its business date from). The seed walks that clock day by day, logs the owner and the cashier in each morning, and sends "still here" every 20 minutes so the lock and idle rules never fire. `entry_log.created_at` stays the real seeding time: only the database sets it (ADR 0028's note). The entry log's flag rules count by the business date inside the row, so the history still has its dates.

## Commands

Run from the repo root, after `pnpm build` (the command runs the built code).

| Command | What it does |
| --- | --- |
| `pnpm seed:demo` | Builds a demo shop **if there is none, or the newest is 7 days old or more**. Run twice in a row, the second run does nothing. |
| `pnpm seed:demo --force` | Builds a new one now (by hand, before an interview). |
| `pnpm seed:demo --days 14` | A shorter history (1 to 400 days). Opening stock scales with it. |

Locally: `pnpm db:up`, `pnpm db:migrate`, `pnpm build`, then `pnpm seed:demo`. To see the buttons, put `DEMO_ENABLED=true` in `.env` and start the app (`pnpm dev`); the login page then shows "Try as the owner" and "Try as a cashier".

On the demo server (after the owner starts RDS and the server, as for any session, ADR 0033):

```
sudo docker compose -f /opt/business-software/compose.yaml --env-file /opt/business-software/release.env exec worker node dist/demo/seed-cli.js --force
```

(Connect with Systems Manager Session Manager, no SSH: `docs/devops/terraform.md`.) The worker's environment already has the runtime database login and `DEMO_ENABLED=true`.

## It refuses to run on the wrong database

ADR 0016: the seed never runs against real data. `seed:demo` stops unless `DEMO_ENABLED=true` is set (the demo server sets it in `deploy/demo/compose.yaml`) or `DATABASE_URL` names `localhost`, `127.0.0.1`, `::1` or `db` (the Compose database). The message never prints the URL.

## The reset: a new shop, never a delete

The app has no DELETE and the entry log is append-only (ADR 0007), so a reset **adds**:

1. The seed builds a new business through the services.
2. As its last step it is flagged `businesses.demo = true` and listed in `auth.demo_businesses` (migration `0022`), so a seed that stops half way leaves an ordinary business that nothing links to, not a half-filled demo.
3. `app_archive_demo_businesses` marks every older demo as archived. Archived, never deleted: the one-click login only opens the newest un-archived one.

**When:** the worker checks at every start (`apps/api/src/demo/worker-reset.ts`): if the newest demo is 7 days old or more it builds a new one in the background. The server is off most of the time (ADR 0032), so there is no nightly job; "worker starts" is the schedule. By hand: `--force` above.

**Size** (measured at P1.20, as D5 asked): 42 days, 1,452 bills, 3,600 bill lines, 3,600 stock movements and 1,700 log entries took **7.5 MB** (5.2 KB a bill) and about 90 seconds on a laptop. Weekly, that is about 400 MB a year against RDS's 20 GB, far under D5's estimate of 2 to 3 GB. The ADR's "two Diwalis need more than a year of history, so older months get fewer bills" belongs to Demo data v3 (P3.1) and was not built here.

## What a visitor may not do

A server-side flag (`businesses.demo`) checked inside each service's own transaction (`apps/api/src/demo/demo-rules.ts`), each with a test (`demo-rules.test.ts`). The answer is `403 demo_refused`, and the web app's banner says why.

- changing the password (by any path: `setPasswordIn` refuses), a new recovery key, forgetting computers (which also ends sessions);
- creating a staff login, changing a login's switches, branches or password, deactivating or bringing one back;
- email: the confirmation "Send again" is refused and a reset request is answered like any other but sends nothing;
- changing the GST status, the business type or the invoice label;
- archiving a branch.

Everything else works. Not built, because the features aren't: the assistant's `$5` cap and 10 questions an hour per visitor (P3.5), and the Excel row limit (Excel import is in the backlog).

## Not done: the "reset by hand" GitHub workflow

D5 also names a GitHub Actions run, with the same approval as a deploy. It needs a second command allowed for the deploy role in Terraform (`infra/terraform/demo/deploy.tf`) and the owner's OK, so it waits. The command above does the same from a Session Manager shell.
