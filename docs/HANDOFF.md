# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 27 — fast track Day 4 finish (2026-11-21): inline, one lane at a time, no background agents.

**Done:**
- **Morning checks:** RDS and EC2 both `stopped` (the 23:30 IST schedule worked). Waiting deploy runs rejected through the API (`POST …/actions/runs/<id>/pending_deployments`, `state=rejected`). Runs queue: rejecting one releases the next.
- **#40 merged** (P1.13 design): it had sat with no checks because it conflicted with `main` in `INTERVIEW_LOG.md`. Merged `main` in, kept both sides' entries.
- **#41 merged** (sitting 3 sheet).
- **#44 merged** (P1.8 PR 2, the stock screens), from `feat/p1.8-stock-page`.
  - **Checked in Chrome** on a fresh local signup: opening stock; Other needs a note; removing down to the Low badge; removing past zero refused in words; Add offers only Count mismatch; the low filter (`low=true`); Settings Block kept after a reload; Hindi; dark mode. In the database: the audit query matched (stock = sum of movements) and the entry log has the rows.
  - **Bug found and fixed test-first:** the history's "By" column was blank for the owner. Owners have no name at signup and no username, and the API test fixture set the owner's name to "Ramesh". Movements now carry `actorRole` (`packages/shared/src/stock.ts`, `apps/api/src/stock/stock.service.ts`); the page shows `session.roles.<role>` when there's no name (`apps/web/src/items/stock.tsx`).
  - **Not checked:** screenshots (Chrome's capture timed out every time) and 1024 px (the resize didn't take). Recorded in `docs/plans/2026-11-20-p1.8-stock-page.md`.
- **#42 merged** (email through the mail-only SES role). `mail_from` is in the git-ignored `infra/terraform/demo/terraform.tfvars`. **Applied** with the owner's OK (6 added, 0 changed, 0 destroyed, $0). The sender is verified (`VerifiedForSendingStatus` `True`).
- **ADR 0042** (owner asked Claude to decide): keep `t4g.small` and move the server to `ap-south-1b`, where RDS is. The other options were rejected: `t4g.micro` has only 1 GB, x86 means multi-architecture images, and a capacity reservation bills while idle.
- `pnpm check`: 1,610 tests pass. Every deploy run from today's merges was rejected; none is waiting.

**Half-done:**
- **The server move (ADR 0042), not started.** The change is `subnet_id = aws_subnet.public[1].id` in `infra/terraform/demo/server.tf` (now `[0]`).

**Next step:**
1. Owner: `aws login --profile business-software` if the sign-in has expired; start Docker Desktop.
2. `/start-session`. Task: the server move.
   1. Branch `feat/server-zone-1b`.
   2. Change `server.tf`, then `terraform plan`. Expect a replacement of `aws_instance` plus anything that names its ID: the stop schedule, deploy, and the DuckDNS update on boot. Check each.
   3. State the cost ($0 extra) and get the **owner's explicit OK**: it destroys the current server, which holds no data.
   4. Apply, then wait for the boot. If `1b` has no capacity, retry at a quieter hour (ADR 0042).
3. Then the first deploy:
   - approve a deploy run, with `DEPLOY_HOLD` lifted (steps: `git show c263c75:docs/HANDOFF.md`);
   - the live check on https://business-software.duckdns.org;
   - one real email (sandbox: only to the verified sender);
   - the backup drill.
4. Then Day 5: P1.13 code once the owner answers #40's 12 questions (`docs/plans/2026-11-20-p1.13-billing-design.md`); P1.5 → P1.6; P2.7.

**Watch out for:**
- **Tokens (owner):** keep sessions short, work inline or with a fresh focused agent (no `fork`), run `/compact` when the context is large, and `/end-session` when a task is done.
- **PR titles max 72 characters:** count them first (`T="…"; echo ${#T}`). #44 failed on 73.
- **A PR showing "no checks" usually has a merge conflict.** `mergeStateStatus` `BEHIND` means: merge `main` in, push, and wait for the checks again.
- **Every merge to `main` starts a deploy run** that waits for approval. Reject it while the server is stopped (API call above), or approve it for the first deploy.
- **The auto-mode permission check blocked `aws ec2 start-instances`.** Starting or moving the server needs the owner present to approve it.
- **Chrome extension:** screenshots timed out all session, and it disconnected at the end. Page text and `javascript_tool` still worked.
- **PowerShell 5.1** breaks `gh … --body "…"`: use `--body-file` or Git Bash. Bash heredocs with many quotes can break too; write a file with the Write tool instead.
- **Local leftovers to OK deleting:** the worktrees `../Business-software-lane1`, `-lane1-cd`, `-lane2-items`, `-lane2-stockui`, `-lane3-billing`, `-lane3-login`, `-lane3-sitting3`, `-lane4-stock`, and their merged branches; a local test business "Stock Check Kirana" in the dev database.
- `aws-mcp` failed to connect again; the AWS CLI works.
