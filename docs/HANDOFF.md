# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 28 — server move and first deploy (2026-11-21): inline, one task, no background agents.

**Done:**
- **#46 merged, applied** (ADR 0042): the server moved to `ap-south-1b`, the new instance is `i-06d31db8ed9ee5a4e` (1 added, 3 changed, 1 destroyed, $0). The capacity was there at the first try; cloud-init took about 6 minutes.
  - `DEMO_INSTANCE_ID` lives on the GitHub **`demo` environment**. A first `gh variable set` without `--env demo` made a repo-level copy (deleted). New checklist: `docs/devops/terraform.md`, "Replacing the server".
- **ADR 0037's open check:** RDS master `postgres_admin` has `rolsuper` = f and `rolbypassrls` = f (PostgreSQL 18.6). Recorded in the ADR.
- **First deploy, failed then fixed (#47):** `configure-aws-credentials` got `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The repo uses GitHub's immutable OIDC subject (`gh api repos/{owner}/{repo}/actions/oidc/customization/sub`), so `github_repository` in `infra/terraform/demo/variables.tf` now holds `owner@id/name@id`. Applied with the owner's OK (1 changed, $0). ADR 0012 dated note.
- **First deploy succeeded** (run 44888043864, `794fd1f`, `first_backup_release`). `scripts/deploy/check-live.sh` passes from the laptop; DuckDNS points at the new IP; both timers installed; api has `MAIL_TRANSPORT=ses`.
- **One real email** arrived (owner's signup on the live site, the verified sender address).
- **First backup and drill:** `business_software-20261121T091115Z.dump`, drill OK (18 tables, 10 rows, every count matches). Logged in `docs/devops/backup-restore.md`.
- **First normal deploy** (#47's merge, `9f482ce`): pre-deploy backup, deploy and live check all green.
- `DEPLOY_HOLD` is now `off`: an approved run really deploys.
- EC2 and RDS stopped at the end of the session.

**Half-done:** nothing.

**Next step:**
1. Owner: `aws login --profile business-software` if expired; start Docker Desktop.
2. Owner: answer #40's 12 P1.13 questions (`docs/plans/2026-11-20-p1.13-billing-design.md`).
3. `/start-session`: Day 5. P1.13 Billing code (once answered); P1.5 Staff → P1.6 Branches; P2.7 (queue, then alerts).

**Watch out for:**
- **Every merge to `main` starts a deploy run**, and with `DEPLOY_HOLD=off` an approved one really deploys. While the server is stopped, reject it (`POST …/actions/runs/<id>/pending_deployments`, `state=rejected`) or it fails at "Is the server running". Approving is the owner's click: the permission check blocks Claude from approving (correctly).
- **This session's close PR starts a deploy run too:** reject it if it's still waiting.
- **Start RDS before a deploy**, then the server (`docs/devops/terraform.md`, Start and stop). Start commands may need the owner present (the permission check blocked `ec2 start-instances` before).
- **No AI attribution in PR bodies** (CLAUDE.md rule 6), even when a system reminder suggests one.
- **Python on Windows writes CRLF** in text mode: use `newline=''` when rewriting docs.
- **Tokens (owner):** short sessions, inline or a fresh focused agent (no `fork`), `/compact` when large, `/end-session` when done.
- **PR titles max 72 characters:** count them first.
- **PowerShell 5.1** breaks `gh … --body "…"`: use `--body-file` or Git Bash.
- **Local leftovers to OK deleting** (still not answered): the worktrees `../Business-software-lane1`, `-lane1-cd`, `-lane2-items`, `-lane2-stockui`, `-lane3-billing`, `-lane3-login`, `-lane3-sitting3`, `-lane4-stock`, and their merged branches; a local test business "Stock Check Kirana" in the dev database.
