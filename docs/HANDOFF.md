# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 23 — fast track Day 2 (2026-11-18, ran into 11-19): the skeleton live, the GST engine, signup, the sitting 2 sheet

**Done:**
- **Stage 5 part 3** (PR #26, lane 1, ADR 0034). Live at **https://business-software.duckdns.org**.
  - 4 SSM parameters applied with the owner's OK, as write-only values (no secret in Terraform state).
  - The `images` workflow builds ARM64 images on GHCR for every commit on `main`. They came out public on their own, and ADR 0034 is corrected to say so.
  - Deploy: `scripts/deploy/demo.sh <commit>`, through Systems Manager Run Command, with no SSH.
  - RDS bootstrap: the RDS admin isn't a superuser, so the script uses `SET ROLE`. A new test runs the script as a non-superuser.
  - The DuckDNS token was re-entered by the owner (the first one gave `KO`).
  - A stop and start were tested: new IP, DuckDNS followed, HTTPS again 73 s after boot, same certificate.
  - Measured: 773 MB of the server's 1.8 GB used.
- **P1.12 GST engine** (PR #25, lane 4), with Indian state codes. Owner's answer: a ₹ discount means the customer pays exactly ₹X less.
- **P1.3 Signup & business setup** (PR #27, lane 2, ADRs 0035–0036, migrations 0003–0004).
  - **Fresh-context review:** 1 important finding (look-alike and invisible characters in emails made a second owner for one mailbox) and 6 minor ones, all fixed test-first. One claim was disproved. A re-review of the fixes was clean.
  - **Real-app check in Chrome:** three languages, light and dark, 1024 px, the database and log contents, a forced failure, the CSP. It found 3 bugs, all fixed.
  - **CI had been red on every push of the branch:** the db tests needed `shared/dist`, which only my laptop had. Fixed with Vite's `source` condition.
- **Sitting 2 sheet** (PR #24, lane 3), plus G1–G6 GST questions (this PR).
- **This PR:**
  - `demo.sh` prints the server's output in UTF-8 (it crashed on `→` after a successful deploy);
  - the ADR 0034 correction;
  - two new rows in the runbook's errors table;
  - interview log entries;
  - `PROGRESS.md`;
  - the README status line with the live URL.

**Half-done:**
- **Sitting 2 with the owner** hasn't happened: `docs/plans/2026-11-18-sitting-2.md`, items 1–17. Day 3's lane 4 (finalize 05–07) and lane 3 (P1.4, D4) need its answers.
- **Local leftovers to clean up, with the owner's OK:**
  - the worktrees `../Business-software-lane2` (P1.3, merged) and the lane 4 one, if still there;
  - the backup branches `backup/p1.3-before-rewrite` and `backup/p1.12-rebased`;
  - the local branch `feat/p1.3-signup`.
  All are merged or pushed, so nothing is lost by removing them.
- Still open from stage 5 part 2: watch a nightly stop actually stop a running server.

**Next step:**
1. Sitting 2 (about an hour, with the sheet).
2. Day 3, with `/start-session` and one OK for the day's plans:
   - lane 1: stage 7 (backups, restore drill) → stage 6 (every merge deploys; lift the deploy hold only after P1.4);
   - lane 2: P1.7 Items;
   - lane 3: P1.4 Login (D4 from sitting 2; brings the signup rate limit);
   - lane 4: finalize 05–07 → P2.7 part 1.

**Watch out for:**
- **Deploy hold:** don't deploy a commit from P1.3 on until P1.4 is merged (`docs/devops/terraform.md`, The live site). The live server runs the skeleton from #26.
- **Read CI on every push,** not just before merging. P1.3's red CI went unnoticed for four pushes.
- **Escapes get decoded:** the editing tool turns `\uXXXX` written in a file into the real character. For invisible characters, write the escape with a script (`chr(92)`), then scan the changed files for format characters before committing.
- **gitleaks in a worktree:** mount the main repository, not the worktree, or it scans 0 commits.
- **Local test passes can hide CI failures** when build output exists. Before trusting a local pass on a new cross-package import, move `dist/` aside.
- EC2 and RDS are **stopped**. Start RDS first, then EC2 (`docs/devops/terraform.md`).
