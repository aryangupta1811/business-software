# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 25 — fast track Day 4, first half (2026-11-20): stage 6 finished and applied, P1.4 PR 2, P1.8 PR 1; three lanes as background forks, merged one at a time

**Done:**
- **Stage 6 CD** (PR #35, merged). Two code reviews, 18 findings, all fixed; `scripts/deploy/test.sh` (41 checks) runs in CI's `check`. **Applied with the owner's OK:** `aws_iam_openid_connect_provider.github`, `aws_iam_role.deploy` (`business-software-demo-deploy`), `aws_iam_role_policy.deploy`; $0. **GitHub `demo` environment** created through `gh api` (owner's choice): required reviewer `aryangupta1811`, deployment branches `main` only, environment secret `AWS_DEPLOY_ROLE_ARN` (piped from `terraform output -raw deploy_role_arn`, never shown), environment variable `DEMO_INSTANCE_ID` = `i-0f09b27db43648140`, repository variable `DEPLOY_HOLD` = `stage 6 not merged yet`.
- **P1.4 PR 2** (PR #37, merged; P1.4 done). Email confirmation, reset by link and by recovery key, new recovery key, change own password, remembered computers; migration `0008_auth_tokens`. **ADR 0040 accepted** (one Mailer: SES on the server through the server's own role, Mailpit locally, `none`, a fake for tests; SES $0.10 per 1,000). **Owner, `00` #41:** recovery-key tries limited per IP only (5 wrong keys per IP an hour), no per-email limit, so knowing the owner's email can't lock them out. Review: 10 findings (6 fixed, 3 answered with reasons, 1 moved to P1.5).
- **P1.8 design and PR 1** (PR #38, merged). Owner answered all seven questions as recommended (`docs/plans/2026-11-20-p1.8-stock-ledger-design.md`, `01` and `06` change logs). `item_stock` + append-only `stock_movements`, `moveStock` as the only writer, `businesses.negative_stock`, API with `stock.view`/`stock.adjust`, **ADR 0041** timeouts (lock 3 s, statement 10 s, idle in transaction 15 s; lock timeout → `503` + `Retry-After: 1`); migration `0009_stock_ledger`, regenerated after #37 so it chains from 0008. Review: 4 findings fixed.
- `pnpm check` on `main` (`54fd17a`) after all three merges: green, 1,576 tests (shared 876, web 238, db 208, api 254).
- Checked before closing: all six worktrees clean with nothing unpushed; no containers running; EC2 `i-0f09b27db43648140` and RDS `business-software-demo` **stopped**.

**Half-done:**
- **The first deploy** (nothing has been deployed since stage 5 part 3). Two deploy runs sit on GitHub: `44688545078` (waiting for approval, commit `08e6658`) and `44692041181` (pending, `54fd17a`). The owner rejects them (Actions → deploy → Review deployments → Reject); `gh run cancel` was blocked by the permission check. If one were approved, `DEPLOY_HOLD` stops it before AWS.
- **P1.8 PR 2:** the Items page stock card, adjustment dialog, history list, the Settings warn/block switch; Chrome check. Branch from the latest `main` (the old `feat/p1.8-stock-ledger` is merged).
- **SES follow-up for #37:** small Terraform PR (SES sender identity, `ses:SendEmail` for the server role) and the server's mail settings (`MAIL_TRANSPORT=ses`, `MAIL_FROM`, `APP_URL`, `EMAIL_LIMITED=true`). Then the owner verifies the sender and recipient addresses. Until then the demo runs `MAIL_TRANSPORT=none` and only the recovery key resets a password.

**Next step:**
1. `/start-session`. `aws login --profile business-software` first (12-hour sign-in; it had expired this morning).
2. **First deploy, with the owner:** reject the two old runs → start RDS, then EC2 (may hit `InsufficientInstanceCapacity` again) → as the master user, `select rolbypassrls from pg_roles where rolname = current_user` (record it in ADR 0037/0027) → set `DEPLOY_HOLD` to `off` → Actions → deploy → Run workflow on `main` with `first_backup_release` ticked → approve → live check → `scripts/deploy/backup.sh now`, `list`, `drill` → log the drill in `docs/devops/backup-restore.md` → stop both.
3. **The whole-day review** of #35 + #37 + #38 together (fast-track evening check, not run yet), and a live smoke check after the deploy.
4. Lanes: P1.8 PR 2; SES follow-up; P1.13 Billing screen; P1.5 Staff → P1.6 Branches; P2.7 (queue, then alerts); the sitting 3 sheet (04, 08, 09; D5, D6).

**Watch out for:**
- **Usage limit:** it hit once today with three lanes running. A stopped lane resumes from where it was when sent a message; its commits are pushed after every step.
- **The permission check blocks** a force-push in a lane prompt and `gh run cancel`. Lanes bring `main` in with a plain merge, never a rebase of pushed commits.
- **Every merge to `main` now starts a deploy run** that waits for the owner's approval. Until the first deploy, reject them. After it, `DEPLOY_HOLD=off` means an approved run really deploys.
- **Docker Desktop doesn't start by itself** after the laptop restarts; tests and lanes need it (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`).
- **`aws-mcp` failed to connect** this session (timeout); the AWS CLI and Terraform worked without it.
- **Migration numbers across lanes:** the second PR to merge regenerates its migration after merging `main` (done for #38 today: byte-identical SQL, new snapshot chain). New tenant tables need `backup_read` policies; new schemas need `app_backup` grants.
- **Flaky web tests under load:** form tests now get 15 s (#37); four signup/login tests still timed out once in a loaded full `pnpm check` and passed alone. CI is green.
- **#37 leftovers:** the 1024 px Chrome check was only partly done (Chrome stopped drawing frames); the login page briefly shows the owner form before the staff tab on a remembered computer (from #33); staff need a change-password screen (P1.5).
- **Unverified:** the 1.5% GST rate vs CBIC before P1.13; the `item_name` collation on RDS.
- **Local leftovers for the owner to OK deleting:** worktrees `../Business-software-lane1` (stage 7), `-lane1-cd` (stage 6), `-lane2-items` (P1.7), `-lane3-login` (P1.4 PR 2), `-lane4-stock` (P1.8 PR 1), all merged; local branches whose remote is gone (`feat/p1.4-login`, `feat/p1.7-items`, `feat/p1.7-items-page`, `feat/stage-7-data-safety`), the merged `feat/stage-6-cd`, `feat/p1.4-email-reset`, `feat/p1.8-stock-ledger`, the PR checkouts `pr32`, `pr33`, `pr35`, `pr37`; `backup/p1.3-before-rewrite` (unpushed, differs from #27); Docker volumes of the lane databases (`bs-lane3` and lane 2's `p17-items`).
