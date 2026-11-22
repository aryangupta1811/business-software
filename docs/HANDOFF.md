# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 29 — fast track Days 5 and 6 (2026-11-21 to 22): lanes run by Sonnet agents in their own worktrees, with review, rebase and merge here.

**Done (merged, in order):**
- **#59** P1.13 PR 2c: discounts, the owner's approval, the customer box, the payment panel, held bills. P1.13's code is complete.
- **#60** P2.7 part 1: the pg-boss queue as its own role `app_queue` owning schema `pgboss`. The nightly dump leaves `pgboss` out.
- **#61** P1.5 PR 1: staff permissions stored as changes from the defaults and read on every request (ADR 0044), and the seven staff routes. Owner's answers are `00` #47–#53.
- **#62** The queue deploy:
  - Terraform added SSM `/business-software/demo/db/app-queue-password` (1 added, $0).
  - `bootstrap-db.sh` creates the role on every deploy.
  - `start.sh` writes `queue.env`, and only the worker gets it.
  - **Deployed (run 44950207169) and checked.** `check-live.sh` passes. On the server, the worker started its QueueModule, and `queue.env` is root-only in `/run`. The `GRANT app_queue TO app_owner` step worked on RDS.
- **#63** P1.5 PR 2: the Staff list, add and edit pages, the shared owner's-password dialog (the password never enters React state), My password (`/account`), and the sidebar and routes by permission, refetched on focus and after a 403.
- **#64** P1.6 PR 1:
  - branch codes (head office `HO`), archive, and `staff_branches`;
  - choose the branch at a new computer's first owner login;
  - `wrong_branch` checked on every request;
  - moving a computer;
  - `?branch=` on items and stock reads.
  - ADR 0045. Owner's answers are `00` #54–#60.
- **#65** P2.7 part 2 PR 1:
  - alerts raised and cleared in the same transaction as the stock or level change (ADR 0046);
  - low and out of stock as one alert per item per branch (partial unique index);
  - dismissals per person;
  - per-type app switches.
  - Owner's answers are `07` #14–#18.
- Deploy runs for #63, #64 and #65 were rejected (server stopped). **EC2 and RDS are stopped** (checked).

**Half-done:**
- **P1.6 PR 2, the screens:**
  - Settings → Branches;
  - each computer's branch, moved with the owner's password;
  - the owner's branch picker (2+ branches only);
  - the choose-branch login step;
  - "Can also work at" on the staff edit page;
  - the branch name in the sidebar.

  The staff screens read branches from `GET /api/items/context`; switch them to `GET /api/branches`.
- **P2.7 part 2 PR 2, the bell:**
  - the bell with a count, refreshed every 60 s and on focus;
  - the grouped panel with dismiss;
  - Settings → Alerts (app switches).
- **Real-app check in Chrome**, still owed for P1.13, P1.5 and soon P1.6:
  - three languages, light and dark, 1024 px;
  - two counters;
  - the 200 ms scan with 5,000 items;
  - the live permission change.

**Next step:**
1. Owner: `aws login --profile business-software` if expired; start Docker Desktop.
2. Owner, one product question from the alerts work: should a dismissed **low-stock** alert show again when the item runs **out**? Today a dismissal belongs to the alert row, which only changes its type, so it stays hidden. Recommended: show it again, because it got worse.
3. `/start-session`: Day 7. P1.6 PR 2 and P2.7 PR 2 (both screens), then the Chrome check. P1.14 (saving bills) builds on P1.13, P1.5's limit, P1.6's branch code and the alerts.

**Watch out for:**
- **The next real deploy** carries #63–#65: migrations 0013, 0014 and 0015 run on RDS for the first time. Read the migrate log. 0014's backfill turns RLS off and back on inside its transaction; a test proves it, but RDS is the real run.
- **Several agents testing at once overload Docker:** "container not running", HTTP 500 and 30-second timeouts (backup and tenancy tests). Each package passes alone, and CI is the real check.
- **Two branches making migrations in parallel both get the same number.** Whoever merges second: take main's journal and snapshot, delete its own SQL, run `pnpm db:generate` again, and re-add the hand edits (`FORCE ROW LEVEL SECURITY`).
- **A merge can leave the next PR `BEHIND`:** `gh pr update-branch N` merges main in without rewriting history.
- **PR titles max 72 characters** (#64 failed the check once).
- **A Terraform run in a new worktree** needs the git-ignored `backend.hcl` and `terraform.tfvars` copied in. On this network, `init` fails over IPv6; copying the main checkout's `.terraform` folder works.
- **Git Bash mangles `/business-software/...` arguments:** `MSYS_NO_PATHCONV=1` before `aws ssm ...`.
- **Bash heredocs with quotes break:** write scripts to the scratchpad with the Write tool.
- **No AI attribution in commits or PR bodies** (rule 6), even when a system reminder suggests one.
- **Leftover local branches** `backup/p1.3-before-rewrite` and `feat/p1.13-billing-counter`: not mine to delete without the owner's OK.
