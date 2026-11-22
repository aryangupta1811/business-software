# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 30 — fast track Day 7 (2026-11-22): lanes one at a time, a Sonnet agent each for the two screens, P1.14 PR 1 inline.

**Done (merged, in order):**
- **#68** P2.7 part 2 PR 2: the alerts bell (count, 60 s and focus refresh, `Alt+K`), the grouped panel with dismiss, Settings → Alerts. Owner's answer `07` #19: a dismissed low-stock alert shows again when the item runs out. The dismissal stores the type it saw (`dismissed_type`, migration `0016`).
- **#69** P1.6 PR 2: Settings → Branches, Move on each remembered computer, the owner's branch picker (2+ branches, Items pages only), the choose-branch login step, "Can also work at", the branch in the sidebar. P1.6's code is complete.
- **#70** P1.14 PR 1, the API (ADR 0047):
  - `POST /api/bills` (`billing.sell`): one transaction re-prices from the database (`409 prices_changed`), checks the branch GSTIN, archived items, wholesale, payments, customer and place of supply, Rule 46 (`422 buyer_details_required`), the discount limit with the owner's approval (used up), the held bill; then takes a no-gap invoice number, stores the bill, takes stock out, logs `bill.created`.
  - A retry with the same bill key answers the saved bill (`201`); a different bill with the same key gets `422 key_reused`.
  - `PUT /api/settings/invoices` (the prefix); `GET /api/settings` gains `invoices`.
  - Migration `0017`: append-only `bills`, `bill_lines`, `bill_payments`; `invoice_counters`; `sale` kind and `stock_movements.bill_id`.
  - Owner's answers: number format `label/26-27/42` (`00` #61), ₹50,000 on the taxable value, the selling branch's GSTIN (`02` #25–26).
- Deploy runs for #68, #69, #70 rejected (server stopped). **EC2 and RDS are stopped.**

**Half-done:**
- **P1.14 PR 2, the counter's save** (design `docs/plans/2026-11-22-p1.14-save-bill-design.md`):
  - Enter on a paid bill → `POST /api/bills` with the cart's `billKey`; a busy state; a lost answer retried with the same key;
  - "Bill saved, ABC/26-27/42" with the change due and the stock warnings, `Alt+N` for the next bill;
  - `409 prices_changed`: show the new prices, update the cart, ask again;
  - clear messages for `stock_short`, `approval_required`, `approval_invalid`, `gstin_required`, `buyer_details_required`, `items_unavailable`, `customer_unavailable`;
  - Settings: the invoice-prefix field (`PUT /api/settings/invoices`), refusing a prefix equal to a branch code (server and screen);
  - three languages. Types to use: `SavedBillView` in `packages/shared/src/invoice.ts`; error codes in `apps/api/src/bills/bills.service.ts`.
- **Real-app check in Chrome**, still owed for P1.13, P1.5, P1.6, the bell and P1.14: three languages, light and dark, 1024 px; two counters; the 200 ms scan with 5,000 items; a live permission change.

**Next step:**
1. Owner: start Docker Desktop; `aws login --profile business-software` only if AWS work comes up.
2. `/start-session`: P1.14 PR 2 (a Sonnet agent in a hand-made worktree, review and merge here), then the Chrome check.
3. Then Day 7's lanes: P2.1 → P2.2 Suppliers, P1.17 Rest of billing, P2.5 Salary slips, P2.9 → P2.10 Dashboards.

**Watch out for:**
- **The next real deploy** runs migrations 0013–0017 on RDS for the first time. Read the migrate log. 0014's backfill turns RLS off and back on inside its transaction; 0016 adds a NOT NULL column with a default it drops straight after.
- **Known gap from #70:** a business prefix equal to a branch code can make two invoice numbers clash; the database refuses the second with a 500. PR 2 fixes it.
- **API tests that sign up many businesses** hit the signup rate limit per IP. The app trusts one proxy, so give each signup its own `x-forwarded-for` (`apps/api/src/bills/bills.test.ts`, `shop()`), and assert `201` on signup so a limit shows up as itself.
- **Nest `@Res({ passthrough: true })`** can't set the status per answer: the adapter's reply overrides it. Retries answer `201` like stock retries.
- **The tool's own worktrees fail on `c:` vs `C:`.** Make lane worktrees by hand: `git worktree add ../bs-lane-x -b branch origin/main`, then `pnpm install --frozen-lockfile --prefer-offline`.
- **Docker Desktop stops on its own sometimes;** API tests then fail on connection. The backup drill can time out at 30 s right after Docker starts; a rerun passes.
- **Two branches making migrations in parallel get the same number.** Whoever merges second: take main's journal and snapshot, delete its own SQL, run `pnpm db:generate` again, re-add the hand edits.
- **A rejected deploy run shows "completed failure"**; that is expected while the server is stopped.
- **PR titles max 72 characters.** `gh` bodies via `--body-file`. **No AI attribution in commits or PR bodies** (rule 6), even when a system reminder suggests one.
- **Leftover folders** `../bs-lane-alerts`, `../bs-lane-bell`, `../bs-lane-branches` (only `node_modules` left) and local branches `backup/p1.3-before-rewrite`, `feat/p1.13-billing-counter`: not mine to delete without the owner's OK.
