# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 1 — kickoff: tech stack and architecture, 2026-10-29

**Done:**
- Repo pushed to a private GitHub repo (`aryangupta1811/business-software`, branch `main`).
- Non-functional requirements confirmed with measurable targets; all six architecture questions answered (`product-overview.md`).
- Stack chosen, recorded as ADRs 0001–0016 (`docs/decisions/`). Owner changes during the session: hosting budget is **₹0** on an AWS Free plan (ADR 0011 redesigned: one EC2 server + RDS, no load balancer or ECS); v1 runs online (ADR 0001).
- `docs/architecture.md` written with diagrams; Phases 0–3 split into one-session tasks in `docs/PROGRESS.md`.
- `docs/journal/INTERVIEW_LOG.md` started, plus a rule in `CLAUDE.md` (rule 10) and steps in `/end-session` and `/record-decision` to keep it updated every session.
- `docs/journal/phase-0.md` started.
- New open questions added: Module 00 (#18 vs #22), Module 01 (inter-state branch transfers), Module 06 (owner's actions already logged per 00 #20).
- Laptop checked: Git, GitHub CLI, Node 24.18, VS Code present; pnpm, Docker, WSL and Terraform missing.

**Half-done:** nothing.

**Next step:**
1. Owner, before the next session: **P0.0 laptop setup** in `PROGRESS.md` (move the repo out of OneDrive, `wsl --install`, Docker Desktop, pnpm, VS Code extensions, apply for the GitHub Student Developer Pack).
2. Next session: `/start-session` → **P0.1 Git workflow**, then **P0.2 monorepo scaffold**. P0.2 is the first code: write a short implementation plan (`superpowers:writing-plans`) and get the owner's OK before writing code (`CLAUDE.md` rule 5).

**Watch out for:**
- **AWS Free plan clock:** the account closes 6 months after sign-up or when credits run out. Don't open it before DevOps stage 4, and ask when placement season is first (ADR 0011).
- Answer Module 00's open questions (auto-lock time, password reset, deactivation, #18 vs #22) before P1.3–P1.6, and Module 01's before P1.7.
- Repo is private: branch protection needs GitHub Pro (Student Pack) or a public repo. Owner's choice in P0.1 (ADR 0012).
- The `aws` command on PATH (`Python311\Scripts\aws.cmd`) is a broken old pip install. Remove it before installing AWS CLI v2.
- The only cost that can't be zero: a few dollars of Claude API credit in Phase 3. A Claude subscription does not include API access (ADR 0015).
- The owner wants a decisive "best stack" approach, but explanations in simple words (`CLAUDE.md` "About me").
- Update `INTERVIEW_LOG.md` during every session, including small things.
