# Fast track: the whole project in 10 days

**Status:** approved by the owner 2026-11-17 ("the exact same output in fewer days, no drop in quality").
**Runs:** Day 1 = Tuesday 2026-11-17 to Day 10 = Thursday 2026-11-26.
**Replaces:** the order in `docs/PROGRESS.md` (the 2026-11-10 demo-first order). The task texts in `PROGRESS.md` stay the source of detail for each task.

## 1. What stays the same

- **Scope.** Every unticked task in `PROGRESS.md`, Phases 1–3 and DevOps stages 5–10. Stage 11 (local Kubernetes) stays a stretch goal, as it always was.
- **Requirements.** Nothing DECIDED changes. The eight DRAFT modules are finalized with `/finalize-module NN`, as before, only earlier and in three sittings (section 5).
- **Quality bar.** Every task meets the same definition of done as today (section 3). No check is skipped, shortened or moved to "later".

**What nobody can promise:** zero bugs. What this plan promises is that every check we use today runs on every change, nothing merges with a red check, and Day 9 repeats the whole-project deep scan of 2026-11-10.

**Why 10 days and not 7:** about 45–50 tasks are left. Four lanes for eight build days give enough room with about 30% to spare. Seven days would leave no spare time for decisions, outside approvals or one hard bug, so the plan finishes building on Day 9 and keeps Day 10 as a buffer.

## 2. Where the days come from

The 60–75 session estimate came from working one task at a time. The time saved comes from how we work, not from the work itself.

| What took time | Fast track |
| --- | --- |
| One task per session, one after another | Up to **four lanes** in parallel, each task in its own git worktree, branch and PR |
| A plan per task, each waiting for the owner's OK | Each morning, the day's plans come together; **one OK covers them** (rule 5 still holds: no code before an approved plan) |
| Module questions asked when the module comes up | **All open questions in three evening sittings** (Days 1–3). Claude drafts a recommended answer for each one |
| Things that need outside approval found when the task starts | **Started on Day 1** (WhatsApp test number, AI key, email/domain) |
| `/start-session` and `/end-session` per task | Once per day |
| Long explanations during the build | A **30–45 minute walkthrough each evening** of what was built, plus the interview log as always |

## 3. Definition of done (unchanged, for every task)

1. A short plan in `docs/plans/`, approved before code.
2. Test-first for every business rule (GST, stock, udhaar, salary and advances). New tenant tables follow ADR 0027; the tenancy guard and the entry log rules hold.
3. A **fresh-context code review** of every PR, by a reviewer that didn't write the code. Every important finding is fixed test-first before merge.
4. `pnpm check` green locally, then all five CI checks green. A red PR is never merged.
5. UI work is checked in the real app in Chrome: light and dark, English, Hindi and Hinglish, 1024 px, no CSP violations.
6. Docs in the same PR: requirement change logs, an ADR for every tech decision, interview log entries, `PROGRESS.md` ticked.
7. From Day 3 (stage 6): the merge deploys, and the live health check passes.

**Every evening:**
- `pnpm check` on the latest `main`.
- A smoke check of the live site.
- One fresh reviewer reads **the whole day's merged diff together**, to catch problems between lanes that a single PR review can't see.
- EC2 and RDS stopped.

## 4. Working in parallel without breaking things

- **Worktrees.** Each lane works in its own git worktree, a second checkout of the repo in its own folder next to the main one (outside the repo, so nothing extra is committed). Each one gets `pnpm install` and its own copy of `.env`.
- **Lanes that can't collide.** On the same day, **no two lanes change the schema of the same table**. The schedule below is built around this rule.
- **Dependencies merge first.** A task starts only after the tasks it depends on are merged into `main`. Two tasks in one lane run one after the other.
- **One merge queue.** Claude merges one PR at a time. GitHub requires each branch to be up to date with `main`, so after every merge the next PR:
  1. rebases onto `main`;
  2. regenerates generated files (the Drizzle migration and snapshot, `routeTree.gen.ts`);
  3. runs `pnpm check` again;
  4. waits for CI.

  A migration is generated only at this step, so migrations land in order and are never edited once on `main`.
- **Shared files.** These change in many tasks: `ENTRY_ACTIONS`, the three locale files, the sidebar, `DEFINER_ALLOWED`. Conflicts in them are resolved by keeping both sides, then re-running the tests.
- **One app at a time.** `pnpm dev` and `pnpm db:up` use fixed ports, so real-app checks run one lane at a time. Tests use Testcontainers (a separate PostgreSQL per run), so they can run in all lanes at once. With 24 GB of RAM the cap is four lanes.

## 5. Owner's part

**Time each day:** about 2 hours.
- Morning, 30 minutes: approve the day's plans.
- During the day: answer lane questions within about an hour, and approve each `terraform apply`. A blocked lane is the main way this plan slips.
- Evening:
  - Days 1–3: a question sitting of about 1 hour.
  - Days 4–10: a 30–45 minute walkthrough.

**Question sittings** (ordered by when the answers are needed; Claude brings a recommended answer and its effect on the schedule for each question):

| Sitting | Evening of | Modules | Plus |
| --- | --- | --- | --- |
| 1 | Day 1 | 01 open questions, finalize 02 and 03 | Decisions D1, D2, D3 |
| 2 | Day 2 | Finalize 05, 06 and 07 | D4 |
| 3 | Day 3 | Finalize 04, 08 and 09 | D5, D6 |

**Decisions:**

| # | Decision | Needed by | Why it can't wait |
| --- | --- | --- | --- |
| D1 | Email for password reset (Module 00 #30, #32): buy a domain (paid outside AWS, about ₹100–1,000 a year; DNS at the registrar, not Route 53, which bills $0.50 a month per zone), or stay on DuckDNS with Amazon SES in its sandbox (email only to verified addresses). The email ADR in P1.4 records the choice | Day 2 evening | P1.4 is on Day 3; SES production access takes about a day to approve |
| D2 | WhatsApp: real Cloud API with Meta's free test number, or a mock that shows the flow (`product-overview.md` question 2) | Day 1 evening | If real, the owner sets up the Meta developer account and test number by Day 4 |
| D3 | AI model and monthly spend cap (Module 09, ADR 0015) | Day 1 evening | The owner creates the Claude Console key with a spend limit by Day 7 (two keys: local and demo) |
| D4 | `entry_log`'s `id` and `created_at` set by the database only (P1.4 e) | Day 2 evening | P1.4 adds a migration on `entry_log` on Day 3 |
| D5 | Public demo rules and how the demo resets (P1.20 a, b) | Day 3 evening | Demo data is on Day 8 |
| D6 | Which ideas from `ideas-backlog.md` are in | Day 3 evening | Built on Day 8 |

The open question "a thin AI slice early, or the full assistant in Phase 3?" goes away: the full assistant is built on Days 8–9.

## 6. Day by day

Lanes are numbered, not named: a lane moves between areas as its work allows. "→" means one after the other in the same lane.

### Day 1: Tuesday 2026-11-17 (half day)

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | This plan (PR) → **stage 5 part 2**: check `rds.force_ssl`, `init`, `plan`, cost, `apply` after OK, the stage 5 plan's step 7 checks, `fmt -check`/`validate` in CI, `docs/devops/terraform.md`, stop both instances | Bootstrap (done) |
| 2 | **Dependency refresh** (PR) | — |
| 3 | Draft recommended answers for sitting 1 | — |
| Owner | Sitting 1; decisions D1–D3 | — |

### Day 2: Wednesday 2026-11-18

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **Stage 5 part 3**: DuckDNS or the D1 domain, database roles and secrets in SSM, image registry ADR, HTTPS with `Strict-Transport-Security`, the skeleton live | Stage 5 part 2 |
| 2 | **P1.3 Signup & business setup** | Module 00 (decided) |
| 3 | Finalize 01, 02 and 03 in the files from sitting 1, re-cut P1.12–P1.19 → draft answers for sitting 2 | Sitting 1 |
| 4 | **P1.12 GST engine** (`packages/shared`, no UI) | Module 02 finalized (lane 3, morning) |
| Owner | Sitting 2; D4 | — |

Stage 7 must come before P1.3 stores real data. So **the live server keeps running the skeleton until stage 7 is done on Day 3**; P1.3 can merge, but it isn't deployed.

### Day 3: Thursday 2026-11-19

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **Stage 7 data safety** first (point-in-time restore, nightly `pg_dump` to S3 as a `BYPASSRLS` role, restore drill with row counts, runbook) → **stage 6 CD** (images built and smoke-tested on GitHub's ARM64 runner, deploy through Systems Manager with a manual go-ahead, health checks, rollback). From here every merge deploys | Stage 5 part 3 |
| 2 | **P1.7 Items** | P1.3, Module 01 |
| 3 | **P1.4 Login & sessions**, with the email ADR | P1.3, D1, D4 |
| 4 | Finalize 05, 06 and 07 from sitting 2 → **P2.7 part 1**: role `app_queue`, pg-boss with `createSchema: false`, outbox, the narrow cross-business read for pending work | Module 07 finalized |
| Owner | Sitting 3; D5, D6 | — |

### Day 4: Friday 2026-11-20

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **P1.8 Stock ledger** (with `app_runtime` timeouts and two-counter tests) | P1.7 |
| 2 | **P1.13 Billing screen** (browser-side catalogue copy decided here) | P1.7, P1.12 |
| 3 | **P1.5 Staff logins & permissions** → **P1.6 Branches** | P1.4 |
| 4 | Finalize 04, 08 and 09 from sitting 3, ADR 0015 updated → **P2.7 part 2**: in-app alerts | P2.7 part 1, P1.4 |

### Day 5: Saturday 2026-11-21

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **P1.9 Excel import** → **P1.11 Branch transfers & stock count** | P1.8, P1.6 |
| 2 | **P1.14 Saving a bill** (atomic, numbering per branch per year, idempotency, concurrency tests) | P1.8, P1.13 |
| 3 | **P2.3 Staff records & attendance** | P1.5, P1.6, Module 05 |
| 4 | **P2.6 Entry-log viewer** → **P2.8 WhatsApp** (real or mock, per D2) | P1.4, Module 06, P2.7 |

### Day 6: Sunday 2026-11-22

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **P1.10 Batches, expiry, variants, IMEI** (including soonest-expiry-first at billing) | P1.8, P1.14 |
| 2 | **P1.15 Printing** (worker build target decided, ARM64 Chromium, memory measured) → **P1.16 Cancellations & credit notes** | P1.14 |
| 3 | **P2.4 Salary rules & advances** (tests for every rule) | P2.3 |
| 4 | **P1.18 Udhaar ledger** → **P1.19 Udhaar views** | P1.14, Module 03 |

### Day 7: Monday 2026-11-23

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **P2.1 Suppliers & purchase entries** → **P2.2 Supplier ledger, payments, returns** | P1.10, Module 04 |
| 2 | **P1.17 Remaining Module 02 features** (as re-cut at finalization) | P1.14–P1.16 |
| 3 | **P2.5 Salary slips (PDF) & payments** | P2.4, P1.15 |
| 4 | **P2.9 Owner dashboard** → **P2.10 Staff dashboard & combined branches** | P1.18, P2.3, Module 08 |
| Evening | **Phase 1 journal** | Phase 1 merged |

### Day 8: Tuesday 2026-11-24

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **Demo data** P1.20 → P2.11 → P3.1: one seed tool, extended three times, with the D5 rules | All features above |
| 2 | **Chosen ideas** from the backlog (D6) | Depends on the picks |
| 3 | **P3.2 AI tools layer** (read-only, permission-checked, unit tests) | Module 09, D3 key |
| 4 | **Stage 9 observability** (structured logs, metrics, dashboards, uptime checks, alert on a failed backup) | Stage 7 |
| Evening | **Phase 2 journal** | Phase 2 merged |

### Day 9: Wednesday 2026-11-25

| Lane | Work | Needs |
| --- | --- | --- |
| 1 | **P3.3 Chat** (tool calling, streaming, three languages) → **P3.5 Guardrails** | P3.2 |
| 2 | **P3.4 Eval set** (written in parallel, run once P3.3 merges; accuracy report) | P3.1, P3.3 |
| 3 | **Stage 10 security review** (secrets, Trivy, dependency audit, HTTPS, least privilege) | Stage 6 |
| 4 | **Whole-project deep scan**, as on 2026-11-10: read every file, attack the database as `app_runtime`; fixes test-first | Everything merged |

### Day 10: Thursday 2026-11-26 (buffer)

1. Anything that slipped, and fixes from the deep scan.
2. An end-to-end run of the live demo in Chrome: every module, three languages, light and dark.
3. **Portfolio polish:** README with the architecture diagram, demo login, runbooks, "how it's deployed and what it costs".
4. **Phase 3 journal**, the interview log's Pitch and Numbers.
5. Stage 11 (stretch) only if everything else is done.

## 7. Cost

- **AWS:** servers on about 12 hours a day for 10 days ≈ 120 h × $0.0372 ≈ **$4.50**, plus disks ≈ $1.50: about **$6 of the $100 credits**. EC2 and RDS are stopped every night.
- **Claude API (Phase 3):** capped by the monthly limit chosen in D3.
- **Domain:** only if D1 says buy one, paid by the owner outside AWS.
- **Claude Code usage:** about four times the usual, because four lanes run at once. See risk 2.

## 8. Risks: what moves the finish date (never the quality)

| # | Risk | What we do |
| --- | --- | --- |
| 1 | The owner isn't available to answer or approve | The blocked lane switches to its next task that doesn't need the answer. DECIDED requirements are never filled in by Claude (rule 2) |
| 2 | Claude Code usage limit reached | Drop to three lanes; the finish moves by about two days |
| 3 | Outside approvals are slow or refused (Meta test number, SES production access, DNS) | Started on Day 1; the lane continues with the parts that don't need them |
| 4 | Finalizing a module adds scope (e.g. e-invoicing in scope) | Claude states the days it adds before the owner decides; added work goes to Day 10 or after |
| 5 | A hard bug or an AWS problem (like the IPv6 one) | Day 10 absorbs about one day |
| 6 | The owner learns less per step | Evening walkthroughs and the interview log; the phase journals are written as before |

If more than one day is lost, the finish moves to Day 11 or 12. The checks in section 3 never shrink to save time.

## Change log

- 2026-11-17: written at the owner's request ("complete the project in 7 to 10 days, the exact same output, no drop in quality"). Rules 5 and 9 in `CLAUDE.md`, `docs/devops/git-workflow.md` and the `/start-session` skill updated to match.
