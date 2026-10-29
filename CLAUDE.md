# Business Software — instructions for Claude Code

## What we're building

One app that runs an Indian product-selling business end to end: GST billing, inventory, udhaar (customer credit), suppliers, staff attendance and salary, entry logs, alerts, a dashboard and an AI assistant. Used on a shop's counter computer. Many businesses can sign up; each sees only its own data.

This is my portfolio project for campus placements, and the project I use to learn DevOps and cloud.

## About me

- College student. I haven't built a full project on my own before. Teach me the process as we go, and explain the why behind each choice in simple words.
- I'm learning DevOps and cloud. For DevOps or cloud work, explain what it is, why we need it, how it works, and how I'd explain it in an interview. When I say "I'll do it", give me the steps instead of running them.
- The tech stack is open. It doesn't have to be limited to what I already know.

## Where everything lives

Read files when a task needs them. Don't load everything at once.

| File | What it holds | When to read |
| --- | --- | --- |
| `docs/PROGRESS.md` | Where the project stands, the build plan, what's next | Start of every session |
| `docs/HANDOFF.md` | Notes from the last session | Start of every session |
| `docs/requirements/README.md` | Index of modules and their status | Choosing what to work on |
| `docs/requirements/product-overview.md` | Original brief, scope, non-functional requirements, open questions | Architecture or cross-module work |
| `docs/requirements/NN-*.md` | One file per module | Only the module being worked on |
| `docs/decisions/` | Architecture Decision Records (ADRs) | Before proposing any tech choice |
| `docs/architecture.md` | How the system fits together, with diagrams | Any code or infra work |
| `docs/devops/DEVOPS_PLAN.md` | DevOps & cloud roadmap | DevOps / infra work |
| `docs/journal/` | Build journal per phase, for interviews | End of each phase |
| `docs/journal/INTERVIEW_LOG.md` | Running interview-prep record of every decision, concept, bug and gotcha | Add to it during every session |

## Stack

TypeScript monorepo (pnpm): React + Vite web app, NestJS modular monolith (api + worker), PostgreSQL + Drizzle with Row-Level Security, Docker Compose locally, GitHub Actions CI/CD, AWS Mumbai Free plan (one EC2 server + RDS, ₹0 budget) via Terraform. Reasons: `docs/architecture.md` and ADRs 0001–0016.

## Rules

1. **Files are the memory, not the chat.** Every decision, requirement change and important finding goes into the right file before the session ends. Never rely on chat history.
2. **DECIDED requirements are the owner's decisions.** Never change them silently. If something is unclear or conflicts, ask me. After I answer, update the file and add a line to its Change log.
3. **DRAFT modules are not built until finalized** with `/finalize-module NN`.
4. **Every tech decision gets an ADR** (`/record-decision`). Don't reopen an accepted ADR unless I ask; if new information suggests changing one, raise it with me.
5. **Plan before code.** For any feature, propose a short plan and wait for my OK.
6. **Small steps, frequent commits.** Commit after each working step with a clear message. Never force-push, rewrite git history, or delete anything under `docs/` without asking. No AI attribution in commits or PRs: no `Co-Authored-By: Claude` lines, no "Generated with Claude Code".
7. **Zero data loss** is the top non-functional requirement (see `product-overview.md`). Business records are never hard-deleted. Nothing destructive — dropping data, destructive migrations, deleting cloud resources — runs without my explicit OK and a fresh backup.
8. **Quality bar.** The frontend must look designed, not like a generic template. The backend: no bugs, no unnecessary code, and tests for every business rule (GST math, stock, udhaar balances, salary and advances).
9. **One task per session.** When the task is done, or `/context` shows the window getting full, run `/end-session`.
10. **Interview log.** Whenever we make a decision, learn a concept, hit an error, fix a bug or discover a gotcha, however small, add an entry to `docs/journal/INTERVIEW_LOG.md` in the same session, in its format. Update its Pitch and Numbers when the project grows.
11. Keep this file under 150 lines. Details go in `docs/`.

## Commands

Filled in by task P0.2 (monorepo scaffold).

- Run: TBD
- Test: TBD
- Lint: TBD
