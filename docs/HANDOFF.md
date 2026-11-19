# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 24 — fast track Day 3 (2026-11-19, ran into 11-20): sitting 2, P1.7 Items, P1.4 login PR 1, stage 7 backups; three lanes run as background forks

**Done:**
- **Sitting 2** (PR #30). The owner took every recommendation except: commission on sales and flag rule 4 moved to the backlog; bills and statements go through the outbox with a document template (07 A1 option a). Modules 05, 06, 07 DECIDED; G1–G6 into `02` #20–25 and `00` #36; `01`'s summary line says one price list per business. Answers table in `docs/plans/2026-11-18-sitting-2.md`.
- **P1.7 Items** (PR #31 data/API/guard, PR #34 page). 8 design questions answered by the owner. Both PRs reviewed (code-review high, 10 findings each, all fixed test-first). Page checked in Chrome. 1,399 tests after #34.
- **P1.4 Login PR 1** (PR #33, ADRs 0038–0039, owner OK'd both). 11 design questions answered (`00` Change log). Review: 9 findings fixed, among them a crash on a login burst and the failure limit beaten by parallel guesses. New tenancy helper `alsoInBusiness` (ADR 0039, 0027 note): checked by me, it only ends a session whose token the browser holds.
- **Stage 7** (PR #32, ADR 0037). The RDS master can't bypass RLS (AWS docs; not yet confirmed on our instance), so backups run as the read-only `app_backup` with a `backup_read` policy on every tenant table and read access to `auth`. Review: 10 findings fixed (restore as `--role=app_owner`, idempotent role script, drill on disk not RAM, no world-readable dump…). **Applied with the owner's OK:** 10 resources, then the S3 `DenyOverwrites` policy (uploads need `If-None-Match: *`). Cost under $0.10 a month.
- Owner's choices: keep `t4g.small` and retry after `InsufficientInstanceCapacity`; delete the `bs-lane3_pgdata` volume (done); worktree `Business-software-lane2` and branches `feat/p1.3-signup`, `backup/p1.12-rebased` removed.

**Half-done:**
- **Stage 6, PR #35** (`feat/stage-6-cd`, worktree `../Business-software-lane1-cd`, plan `docs/plans/2026-11-19-stage-6-cd.md`). Built, CI green, **not applied**. Ten review findings are in the PR description, items 1–7 first: job-level concurrency; never deploy an older commit; a timeout that can't cut a rollback; no rollback to the same sha; `previous-release.env` after a rollback; the role can reach secrets through `AWS-RunShellScript` (say so in the ADR; the real boundary is the `demo` environment); drop `ssm:ListCommandInvocations`. Then: re-plan (3 to add, $0), owner's OK, apply; owner sets up the `demo` environment (reviewer, `main` only, `AWS_DEPLOY_ROLE_ARN`, `DEMO_INSTANCE_ID`, `DEPLOY_HOLD=off`).
- **First deploy** (lifts the deploy hold; both conditions are met). Start RDS, then EC2 (may hit the capacity error again). Then: `select rolbypassrls from pg_roles where rolname = current_user` as the master (records the result in ADR 0037/0027), deploy `main`, `scripts/deploy/backup.sh now`, `list`, `drill`, log the drill in the runbook. Stop both.
- **P1.4 PR 2** (`feat/p1.4-email-reset`, worktree `../Business-software-lane3-login`, last commit 717ae5a): code for email (Mailpit locally, SES on the server), confirmation, reset by link and by recovery key, new recovery key, change own password, remembered computers. **Its migration says 0007 and must become 0008** (stage 7 took 0007). Left: email ADR 0040, docs, SES price via the Pricing API, one full `pnpm check`, Chrome check, PR, review. SES Terraform is a separate small PR after it.
- **P2.7 part 1** (job queue), Day 3's lane 4 second half, not started.

**Next step:**
1. `/start-session`: finish stage 6 (#35 findings → apply → `demo` environment → first deploy) and P1.4 PR 2 as two lanes.
2. Day 4 lanes as capacity allows: P1.8 Stock ledger, P1.13 Billing screen, P1.5 Staff → P1.6 Branches, P2.7. Sitting 3 (04, 08, 09; D5, D6) needs its sheet first.

**Watch out for:**
- **Usage limit:** three lanes plus `code-review high` on every PR hit the 5-hour limit three times. Use two or three lanes. A lane stopped by the limit resumes where it was (its work is saved); check AWS state first (an RDS start was in flight once).
- **The permission check blocks `terraform apply` inside a fork** even with the owner's OK; the main session ran both applies itself. Plan in the lane, apply from the main session.
- **AWS sign-in lasts 12 hours:** run `aws login --profile business-software` before AWS work. Terraform on this laptop needs `TF_CLI_CONFIG_FILE` pointing at the provider-mirror config (IPv6 problem; `docs/devops/terraform.md`).
- **Migration numbers collide across lanes:** each lane checks `origin/main` before numbering; the second to merge renumbers and regenerates (also the `backup_read` policies for any new tenant table, and the `app_backup` grants for any new schema: a new schema broke the backup once).
- **Flaky under load:** P1.3/P1.4 web tests (signup, login by email) time out at 5 s locally when several lanes' containers run; CI is green. Consider a longer timeout.
- **Unverified:** the 1.5% GST rate (polished diamonds) vs CBIC's notification, before P1.13; the `item_name` collation on RDS.
- Local leftovers: worktrees `../Business-software-lane1` (stage 7, merged) and `../Business-software-lane2-items` (P1.7, merged) can go; Docker volume of lane 2's `p17-items` database; branch `backup/p1.3-before-rewrite` (unpushed, differs from #27; owner to look).
- EC2 and RDS are **stopped**.
