# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 32 — fast track Day 8 (2026-11-23, into 11-24): four lanes; two finished and merged, two started. About a day behind the schedule.

**Done (merged, in order):**
- **#78** the three Chrome-check fixes (connecting state, real next invoice number, "Coming later").
- **#76** P1.18 udhaar design (`03` #17–#23) and **#77** P1.15 printing design (`02` #28–#34); the owner took every recommendation.
- **#79** P2.3 PR 2, staff and attendance screens, plus `GET /api/attendance/people`.

**Half-done (committed on local branches, not pushed, not reviewed):**
- **P1.18 PR 1, udhaar API:** `feat/p1.18-udhaar-api` in `../bs-lane-udhaar`, commit `70dce57`. `origin/main` (#79) not merged in yet.
  - Done: shared rules (`packages/shared/src/udhaar.ts`, billing, customers, staff; the lane reported 1,136 shared tests green) and migration `0019_udhaar_ledger.sql` with the schema.
  - `packages/db/src/udhaar.ts` is a **stub that throws**; `udhaar.test.ts` (about 29 tests) is red on it. Two later fixes to the test file were only type-checked.
  - Next, in order: run that test red; implement `lockUdhaarAccount`, `moveUdhaar`, `findUdhaarMismatches`; add `REVOKE UPDATE ON "udhaar_entries" FROM app_runtime;` at the end of the migration (the role test is red until then); add the table to `APPEND_ONLY` in `tenancy-guard.test.ts`; then test-first: entry-log actions, settings, customers, approvals, `POST /api/bills`, the routes, ADR 0050 with its README row and the ADR 0007 note, `MONEY_PAYMENT_MODES` in the web payment panel, the switch's name and the error messages in three languages.
  - Choices to review: the design's section 11.
- **P1.15 PR 1, printing:** `feat/p1.15-printing` in `../bs-lane-print`, commit `2b48152`, #79 already merged in.
  - Done: `whatsAppLink`, `amountInWords`, the shared printing types, `packages/print` set up.
  - `pnpm typecheck` **fails with 8 errors**; the lane expects this until the API and web fill the new `printing` field in the session, devices and settings views. The `printing.ts` schemas were written before their tests and `sample.ts` has none: mutation-check both.
  - Not started: the bill template and its CSS, the settings migration and routes, the bills API, printing and the Bills page, Settings → Printing, the setup guide, the locales.
  - Findings and plan: the design's section 11.
- **#79's Chrome check:** done at 1536 px, dark, mostly by page text. Left: 1024 px (read `innerWidth` after resizing) and light mode. Still left from before: two counters, a live permission change, Branches (a second Chrome profile).

**Owner's answers (2026-11-24, session 33):** credit limit and due days owner-only (`03` #24); printing keys `Alt+P`, `Alt+A`, `Alt+W`, Bills page `Alt+V` (`02` #30, #31); the register's header becomes "Everyone due today is in" (to do, small fix).

**Sitting 3 held 2026-11-24:** 04, 08, 09 DECIDED; D5 in ADR 0016's dated note; D6: cash closing, then expenses, after v1. Opening balance at any time (`03` #20, built in P1.18 PR 2).

**Next step:** `/start-session`, then one task: finish P1.18 PR 1 in its worktree, review, merge. Then P1.15 PR 1. Then Day 9. Tell the owner what the lost day means for 2026-11-29.

**Watch out for:**
- **The agents that built the lanes are gone.** Their notes are here and in the two designs.
- **Migration numbers:** only udhaar has `0019` so far; printing needs its own, and whoever merges second regenerates.
- **Local test failures, cause not known:** under `pnpm check`, `packages/db` `backup.test.ts` failed twice and web `devices-move.test.tsx` failed once in a combined api and web run. Each passed alone and CI was green. Read the error next time. `billing.test.ts` "the overlap" can also flake (two clocks).
- **"No checks" on a PR** can mean a conflict: look at `mergeable`, then merge `origin/main` into the branch. Never force-push. `docs/journal/INTERVIEW_LOG.md` conflicts whenever two branches add entries: keep both.
- **With worktrees, run `gh pr create` with `--head` and `--base`**, or it uses the current folder's branch.
- **Chrome:** screenshots time out often, mostly after a page load; read the page with JavaScript. The extension was disconnected at times on both days. Docker Desktop can be off: check `docker ps`.
- **An idle owner session locks** after the business's lock minutes (default 5), even while a script calls the API from the page.
- **The next real deploy** runs migrations 0013–0018 on RDS for the first time. Read the migrate log. 0014 and 0018 turn RLS's FORCE off and on inside their transactions for backfills.
- **The AWS MCP server didn't connect** this session; nothing needed it.
- **The usage limit** stopped both lanes on 2026-11-23. Have each lane commit its first tested slice.
- **Older `.env` files lack six keys** (`docs/devops/local-database.md`).
- **Make lane worktrees by hand** (the tool's own fail on `c:` vs `C:`): `git worktree add ../bs-lane-x -b branch origin/main`, copy `.env`, then `pnpm install --frozen-lockfile --prefer-offline`.
- **PR titles max 72 characters.** `gh` bodies via `--body-file`. **No AI attribution in commits or PR bodies** (rule 6).
- **Leftover folders** (not worktrees): `../bs-lane-alerts`, `-attendance`, `-bell`, `-branches`, `-customer`, `-fixes`, `-keys`, `-pay`, `-queue`, `-save`, `-staff-screens`, `-staff-ui`; local branches `backup/p1.3-before-rewrite`, `feat/p1.13-billing-counter` (listed by session 31). Delete only with the owner's OK. Test businesses "Chrome Check Kirana" and "Attendance Check …" are in the local database.
