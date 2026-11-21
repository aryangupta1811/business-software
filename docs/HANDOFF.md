# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 26 — fast track Day 4, second half (2026-11-20, closed 2026-11-21): three lanes; the usage limit stopped lane 2 and the session. Closed early on the owner's request to save tokens.

**Done:**
- **#39 merged:** session 25's close-out docs.
- **SES follow-up, PR #42** (`feat/ses-mail-role`, open, not merged). Found before writing it: ADR 0040 had the api sign SES with the instance role, but the api is in a container and the metadata hop limit of 1 blocks that, so email would have failed on the server. **Owner chose a mail-only role:**
  - `infra/terraform/demo/mail.tf` (SES identities, role `business-software-demo-mail` that may only send as `mail_from`, the server may assume only it, two SSM parameters);
  - `deploy/demo/mail-credentials.sh` + a 20-minute systemd timer (1-hour credentials in `/run/business-software-mail`, read-only in the api, `credential_process`);
  - `start.sh` falls back to `MAIL_TRANSPORT=none`.
  - Tests: 54/54 `scripts/deploy/test.sh` on Linux (the mail checks skip in Git Bash). The SDK refresh was checked in the app image (it re-runs `credential_process` only once the held credentials expire). shellcheck clean.
  - ADR 0040 dated note, runbook section in `terraform.md`, interview log entry — all in #42.
  - CI: four checks green; `pr-title` failed (76 > 72 characters). Renamed on 2026-11-21, so it re-runs by itself.
- **Lane 3 (done):** **#40** P1.13 billing design, ending in 12 owner questions with recommendations (`docs/plans/2026-11-20-p1.13-billing-design.md`); **#41** sitting 3 sheet (`docs/plans/2026-11-20-sitting-3.md`: 04, 08, 09, D5, D6). Both open. **1.5% GST checked:** a real rate (IGST notification 9/2025, cut and polished diamonds); the amendments 19/2025 and 1/2026 were not read.
- **RDS started** 2026-11-20 12:51 IST, after two `InsufficientDBInstanceCapacity` errors (`ap-south-1b`). **EC2 never started:** 20 tries over an hour, all `InsufficientInstanceCapacity` for `t4g.small`. So no first deploy.

**Half-done:**
- **Lane 2, P1.8 PR 2** (branch `feat/p1.8-stock-page`, worktree `../Business-software-lane2-stockui`, pushed, clean): plan `docs/plans/2026-11-20-p1.8-stock-page.md`, the stock screens, review fixes (commit `d3643ab`). **Left:** the Chrome check (it had just run migrations and was starting `pnpm dev`), then `gh pr create`. No PR yet.
- **#42:** `terraform plan` needs `mail_from` (and optional `mail_recipients`) in the git-ignored `infra/terraform/demo/terraform.tfvars`. **Waiting on the owner for the sender address.** Then plan (≈ $0) → owner's OK → apply → owner clicks AWS's verification emails → merge → one real email on the server.
- **First deploy:** blocked by EC2 capacity (steps in the 2026-11-20 handoff, `git show c263c75:docs/HANDOFF.md`).

**Next step:**
1. Owner: `aws login --profile business-software`, start Docker Desktop, reject the waiting deploy runs (Actions → deploy → Review deployments), and **check RDS is stopped** (`aws rds describe-db-instances --profile business-software --region ap-south-1 --db-instance-identifier business-software-demo --query "DBInstances[0].DBInstanceStatus"`); the 23:30 IST schedule should have stopped it, and it couldn't be checked because the sign-in had expired.
2. `/start-session`. One lane at a time, in this order:
   1. Merge #40, #41 (docs).
   2. Lane 2: Chrome check of the stock screens, open its PR, merge.
   3. #42: owner gives the sender address, plan, apply, merge.
   4. **Decide with the owner what to do about EC2 capacity.** The owner chose on 11-19 to keep `t4g.small` and retry, and it has now failed two days running. Options to put to them: retry at another hour; another Free-plan instance type; another subnet or zone (replaces the server). That decision gates the first deploy, its live check and the backup drill.
   5. Then Day 5 per the schedule (P1.13 code after the owner answers #40's questions).

**Watch out for:**
- **Tokens (owner, 2026-11-21):** keep sessions short and lanes few.
  - A `fork` lane copies this whole conversation, so it's expensive. Prefer a fresh `general-purpose` agent with a focused prompt, or work inline.
  - Run `/compact` when the context gets large, and `/end-session` once a task is done.
- **Usage limit:** it stopped lane 2 at 16:50 IST on 11-20. A stopped lane resumes only within its own session; this session is closing, so the next one continues lane 2 inline from its pushed branch.
- **PR titles max 72 characters** (`scripts/ci/check-pr-title.sh`).
- **PowerShell 5.1 breaks `gh … --body "…"` and `--jq` with quotes:** use `--body-file` or Git Bash.
- **Mail tests in `scripts/deploy/test.sh` run only on Linux.** Locally, use a Debian container that mounts only `scripts/` and `deploy/`; copying the whole repo, `node_modules` included, takes minutes.
- **AWS capacity in Mumbai:** `t4g.small` (EC2, `ap-south-1a`) and `db.t4g.micro` (RDS, `ap-south-1b`) both refused to start on 11-19/11-20. RDS came up after about 6 minutes of retries; EC2 not in an hour.
- `aws-mcp` failed to connect again; the AWS CLI works.
- Still true from session 25: every merge to `main` starts a deploy run that waits for approval and stops at `DEPLOY_HOLD`; flaky web form tests under load; `#37` leftovers; local leftovers to OK deleting (old worktrees and branches, now also `../Business-software-lane3-billing`, `-lane3-sitting3` once #40/#41 merge).
