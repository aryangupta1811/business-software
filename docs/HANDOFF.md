# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 31 — fast track Day 7 (2026-11-22): two Sonnet lanes in hand-made worktrees, reviewed and merged here; a partial Chrome check; the owner's **portfolio cut**.

**Done (merged, in order):**
- **#72** P2.3 design (`docs/plans/2026-11-22-p2.3-staff-attendance-design.md`), owner took 1A–5A (`05` #29–#33).
- **#73** P1.14 PR 2, the counter's save, and Settings → Invoice numbers. Review fix: after a lost answer the bill stays locked until Enter gets an answer. P1.13 and P1.14 are code-complete.
- **#74** P2.3 PR 1, the API (ADR 0048, migration `0018`). Mutation-checked: the past-day reason and "not your own day" rules.
- **Portfolio cut** (this PR, `docs/portfolio-cut`): finish moves to **2026-11-29**; deferred tasks are in `docs/requirements/ideas-backlog.md` ("Deferred from v1"), each restorable with "bring back P1.10" and so on. Owner decisions: WhatsApp click-to-chat in v1 (ADR 0049, `02` #27, `03` #16); "Coming later" feature switches (`00` #62). Plan: `docs/plans/2026-11-17-fast-track.md` section 9.

**Chrome check (local, 5,057 items):** scans 4–8 ms; GST lines right; pay, save, change, `Alt+N`; a prefix equal to a branch code refused; Hindi light and Hinglish dark at 1024 px; the bell. Test business "Chrome Check Kirana" is in the local database (its owner lock raised to 30 min for the check).

**Half-done:**
- **Fixes from the Chrome check** (Day 8, lane 4), each test-first:
  1. Blank page while the session can't be read: `apps/web/src/routes/_app.tsx` returns `null` while the query is pending, and it retries, so a down server shows nothing for 20 s or more. Show "Connecting to the server…" (three languages) and limit the retries.
  2. Settings → Invoice numbers shows "Your next bill: …/42", a fixed example: show the real next number, or "For example".
  3. "Coming later" on the switches P1.10 owns (`00` #62): batches, expiry dates, expiry alerts, variants, serial numbers, warranty. Keep the stored choices.
- **The rest of the Chrome check:** two counters, a live permission change, Branches, Staff. Needs a second Chrome profile (one profile shares one login cookie).

**Next step:**
1. Owner: Docker Desktop on. **Sitting 3** on the evening of Day 8 (`docs/plans/2026-11-20-sitting-3.md`, about an hour); it unblocks P2.1, the dashboards, demo data and the AI assistant.
2. `/start-session`: Day 8 lanes (PROGRESS schedule): P2.3 PR 2 screens, P1.18 Udhaar ledger, P1.15 Printing (with the click-to-chat link builder in `packages/shared`), the fixes above.

**Watch out for:**
- **The next real deploy** runs migrations 0013–0018 on RDS for the first time. Read the migrate log. 0014 and 0018 turn RLS's FORCE off and on inside their transactions for backfills.
- **Flaky locally, green in CI:** `apps/api/src/billing/billing.test.ts` "the overlap" compares Node's clock with PostgreSQL's `now()`; it flaked after a Docker restart (probably clock drift, not confirmed). If it fails in CI, take the server time from the database.
- **Docker Desktop's engine can stop answering** (the CLI gets a 500); the API then times out on every request. Restart Docker Desktop, then `pnpm db:up`; data is in the volume.
- **The Chrome extension's screenshot hangs** right after a native `<dialog>` opens or the page navigates; read the page with JavaScript instead, then screenshot after it closes.
- **An idle owner session locks** after the business's lock minutes (default 5) even while a script calls the API from the page; bulk loads stop with `401 locked`.
- **Older `.env` files lack six keys** (`docs/devops/local-database.md`).
- **Sonnet agents wrote API code before its tests** this session; mutation-check the key rules when reviewing.
- **The tool's own worktrees fail on `c:` vs `C:`.** Make lane worktrees by hand: `git worktree add ../bs-lane-x -b branch origin/main`, then `pnpm install --frozen-lockfile --prefer-offline`.
- **Two branches making migrations in parallel get the same number.** Whoever merges second regenerates.
- **PR titles max 72 characters.** `gh` bodies via `--body-file`. **No AI attribution in commits or PR bodies** (rule 6).
- **Leftover folders** `../bs-lane-alerts`, `../bs-lane-bell`, `../bs-lane-branches`, `../bs-lane-customer`, `../bs-lane-keys`, `../bs-lane-pay`, `../bs-lane-queue`, `../bs-lane-staff-ui` and local branches `backup/p1.3-before-rewrite`, `feat/p1.13-billing-counter`: not mine to delete without the owner's OK.
