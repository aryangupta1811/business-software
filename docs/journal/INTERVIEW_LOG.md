# Interview log

A running record of everything that happens while building this project: decisions, concepts, bugs, errors, commands and small gotchas. It is written so I can revise before an interview. Claude adds entries during every session (rule in `CLAUDE.md`), and I can add my own.

**How to revise:** read the Pitch and Numbers, then the Question bank, then skim the Log for stories. Search by tag, e.g. `#database`.

**Tags:** `#product` `#requirements` `#process` `#git` `#github` `#architecture` `#database` `#security` `#money` `#gst` `#frontend` `#backend` `#testing` `#devops` `#cloud` `#cost` `#ai` `#mistake` `#gotcha`

The phase journals (`phase-N.md`) are the short story of each phase. This file is the detailed diary behind them.

---

## Pitch

Update this as the project grows.

**30 seconds:** I'm building a multi-tenant web app that runs an Indian retail shop: GST billing, inventory, customer credit (udhaar), staff attendance with salary and advances, an audit log, alerts on WhatsApp, and an AI assistant that answers questions about the shop's own data. The focus is correctness: nothing is ever deleted, a bill and its stock change save together or not at all, and each business's data is kept apart by the database itself. I also used it to learn DevOps: Docker, CI/CD with GitHub Actions, Terraform and AWS.

**2 minutes:** *(fill in as we build: the problem → what makes it hard → my architecture → one hard bug I solved → how it's deployed → what I'd do differently)*

---

## Numbers to remember

| What | Value | Where it comes from |
| --- | --- | --- |
| Max data loss in a disaster (RPO) | 5 minutes | RDS point-in-time restore — `product-overview.md` NFR 1 |
| Max time to recover (RTO) | 1 hour | Restore runbook + monthly drill |
| Scanned item appears on screen | < 200 ms | NFR 5 |
| Bill save | < 1 second | NFR 5 |
| Cloud budget | ₹0: AWS Free plan, up to $200 credits over 6 months | ADR 0011 |
| Hosting cost target | ~$25–35 / month of credits | ADR 0011 |
| Money stored as | whole paise (₹12.50 = 1250) | ADR 0008 |
| Largest exact amount in JavaScript | ≈ ₹90 lakh crore in paise (2^53) | ADR 0008 |
| Business types in v1 | 5 | Module 00 |
| Modules | 10 (00–09) | `docs/requirements/` |
| ADRs written at kickoff | 16 | `docs/decisions/` |

---

## Question bank

Short answers; the Log entry has the full story.

- **Q: Why a modular monolith and not microservices?**
  A: A bill must save the bill, stock change, udhaar entry and audit log in one database transaction. In one process with one database that's a single `BEGIN…COMMIT`. With microservices it needs sagas and compensation, which is overkill for one developer. → ADR 0004
- **Q: How do you keep one business from seeing another's data?**
  A: Every row has a `business_id`, and PostgreSQL Row-Level Security filters every query by the business set for the current transaction. Even if my code forgets a `WHERE`, the database refuses. Tests try cross-business reads on purpose. → ADR 0006
- **Q: Two counters sell the last unit at the same moment. What happens?**
  A: Both run inside transactions that lock the stock row. The second waits for the first, then sees the updated number. Invoice numbers come from a locked counter row, so there are no duplicates or gaps. → ADR 0007
- **Q: The network drops while a bill is saving. Is it saved twice?**
  A: No. The screen sends an idempotency key with the bill. If it retries, the server sees the key already used and returns the original bill. → ADR 0007
- **Q: Why not store money as a decimal number?**
  A: Floating point can't represent 0.1 exactly (0.1 + 0.2 = 0.30000000000000004). I store whole paise as integers, so every sum is exact, and rounding happens in one tested place. → ADR 0008
- **Q: Why sessions and not JWTs?**
  A: When a staff member leaves, or the owner's screen locks, access must stop immediately. A session in the database can be revoked at once. A JWT stays valid until it expires. → ADR 0009
- **Q: How do you make sure a WhatsApp alert isn't lost if the server crashes?**
  A: The outbox pattern. The alert is written to a table in the same transaction as the business action, and a worker sends it later with retries. Commit means the message will go out; rollback means it never existed. → ADR 0010
- **Q: How does the AI avoid making up numbers or leaking salaries?**
  A: It can't query the database. It can only call a fixed set of my own functions, which run with the asking user's permissions. Every number in an answer comes from a function result. → ADR 0015
- **Q: How does CI deploy to AWS without storing AWS keys in GitHub?**
  A: OIDC. GitHub proves its identity to AWS for each run and gets short-lived credentials for one IAM role, so there's no long-lived secret to leak. → ADR 0012
- **Q: How did you host it with no budget?**
  A: AWS Free plan credits, and a design sized to them: one EC2 server running the same Docker Compose stack as my laptop, plus RDS for managed backups. I skipped the load balancer, NAT gateway and ECS, which would have used the credits in about 4 months. Everything is Terraform, so moving to ECS later is an infrastructure change only. → ADR 0011
- **Q: What's RPO and RTO for your app?**
  A: RPO is how much data you can lose (5 minutes, thanks to point-in-time restore). RTO is how long recovery takes (1 hour, checked by a monthly restore drill). → `product-overview.md` NFR 1
- **Q: Why did you test against a real database instead of mocks?**
  A: The bugs I care about (locks, concurrency, Row-Level Security) only exist in the real database. Testcontainers starts a throwaway PostgreSQL for each test run. → ADR 0013

---

## Glossary

Terms I learned on this project, in one line each.

| Term | Meaning |
| --- | --- |
| ACID | Transactions are Atomic (all or nothing), Consistent, Isolated (don't see each other's half-work), Durable (survive crashes) |
| ADR | Architecture Decision Record: a short file explaining one technical choice and why |
| Argon2id | A deliberately slow password-hashing algorithm, recommended by OWASP |
| CI / CD | Continuous Integration (test every change automatically) / Continuous Deployment (ship every green change automatically) |
| CSRF | A trick where another site makes your browser send a request with your cookies; blocked with SameSite cookies + tokens |
| FEFO | First Expiry, First Out: sell the batch that expires soonest |
| httpOnly cookie | A cookie JavaScript can't read, so a script injected into the page can't steal the session |
| IaC | Infrastructure as Code: cloud resources created from code files (Terraform) instead of clicking in a console |
| Idempotency key | A unique ID sent with a request so repeating it has the same effect as sending it once |
| Modular monolith | One deployable app split internally into modules with clear boundaries |
| OIDC | OpenID Connect: lets one system prove its identity to another and get short-lived credentials |
| ORM | A library that maps database tables to code (Drizzle here) |
| Outbox pattern | Write "send this message" into the database in the same transaction, send it later from a worker |
| PITR | Point-in-time restore: rebuild the database as it was at any second in the retention window |
| RLS | Row-Level Security: PostgreSQL policies that decide which rows a query is allowed to see |
| RPO / RTO | Recovery Point Objective (max data you can lose) / Recovery Time Objective (max time to recover) |
| SPA | Single-page app: the browser loads the app once and then only exchanges data with the server |
| Tenant | One customer business in a multi-tenant system |
| Text shaping | Turning letters into correctly joined glyphs; Hindi (Devanagari) needs it for conjuncts like क्ष |

---

## Log

Entry format:

```markdown
### YYYY-MM-DD — Short title `#tag`
- **What happened:**
- **Why / what I learned:**
- **Say it in an interview:**
- **Follow-ups to expect:**
```

### 2026-10-29 — Studied the competition before designing `#product`
- **What happened:** Before writing requirements, compared the idea with Vyapar, myBillBook and Khatabook, plus AI shop assistants such as Khata Bhai.
- **Why / what I learned:** The features alone aren't unique. The edge has to be depth and correctness: staff + advances + udhaar + permissions + an AI that respects permissions, all in one well-built app.
- **Say it in an interview:** "I checked the market first. Since the feature list existed already, I competed on correctness and depth — a few polished modules beat many half-built ones."
- **Follow-ups to expect:** Who are the users? What would make a shop switch from Vyapar?

### 2026-10-29 — Requirements live in files, with DECIDED / DRAFT labels `#requirements` `#process`
- **What happened:** Moved all requirements from a chat into `docs/requirements/`, one file per module, each marked DECIDED or DRAFT, with a Change log. The repo is the single source of truth.
- **Why / what I learned:** Chats get lost or compacted; files in git have history. Labels stop half-formed ideas from being built as if they were agreed.
- **Say it in an interview:** "Every requirement has a status and a change log, so I always know what's agreed and why it changed."
- **Follow-ups to expect:** How do you handle a requirement change mid-build?

### 2026-10-29 — One app with business-type presets, not five apps `#product` `#architecture`
- **What happened:** Decided (Module 00) that kirana, medical, clothing, electronics and hardware are presets that switch features on, inside one app.
- **Why / what I learned:** This is the feature-flag idea: one codebase, behaviour controlled by settings. Mixed shops can switch on extra features.
- **Say it in an interview:** "Business types are configuration, not code branches. One codebase serves all five."
- **Follow-ups to expect:** How do you store type-specific item fields? (JSONB / optional columns — decided when building Module 01.)

### 2026-10-29 — Git and GitHub set up `#git` `#github`
- **What happened:** First commit "Import requirements from planning chat", renamed `master` → `main`, created a private GitHub repo and pushed.
- **Why / what I learned:** The requirements were safe in the cloud before any code existed. `main` is GitHub's default branch name.
- **Say it in an interview:** "I pushed the requirements on day one, so the laptop was never the only copy."
- **Follow-ups to expect:** What's your branching strategy? (Branch protection + PRs come in Phase 0, DevOps stage 1.)

### 2026-10-29 — GitHub login: Credential Manager vs `gh` `#github` `#gotcha`
- **What happened:** I had trouble logging in to GitHub. `gh auth login` is interactive, so Claude's terminal can't answer its prompts. The simpler route: Git for Windows ships Git Credential Manager, which opens a browser sign-in on the first `git push`.
- **Why / what I learned:** Git over HTTPS needs a credential. A credential helper stores it safely, and interactive commands must be run by me.
- **Say it in an interview:** "Git doesn't use your GitHub password over HTTPS any more; it uses a token or OAuth through a credential helper."
- **Follow-ups to expect:** HTTPS vs SSH for git? Personal access tokens?

### 2026-10-29 — Branch protection on a private repo needs GitHub Pro `#github` `#gotcha`
- **What happened:** While planning DevOps stage 1, found that GitHub Free only offers branch protection on public repos. Private repos need GitHub Pro, which students get free through the GitHub Student Developer Pack (along with cloud credits).
- **Why / what I learned:** Check plan limits before designing a workflow around a feature.
- **Say it in an interview:** "`main` is protected: changes only arrive through pull requests with green CI."
- **Follow-ups to expect:** What do branch protection rules enforce? (Required reviews and status checks; no force-push.)

### 2026-10-29 — The project folder is inside OneDrive `#gotcha` `#git`
- **What happened:** Noticed the repo sits in a OneDrive-synced Desktop folder.
- **Why / what I learned:** OneDrive syncing files while git writes them can corrupt `.git`, and `node_modules` (tens of thousands of files) slows sync badly. GitHub is the backup, not OneDrive. Plan: move it to e.g. `C:\Users\18ary\projects\business-software`.
- **Say it in an interview:** (small, but shows care) "I kept the repo out of cloud-sync folders: git is the version control, GitHub is the backup."
- **Follow-ups to expect:** —

### 2026-10-29 — Turned vague requirements into measurable targets `#requirements` `#devops`
- **What happened:** Confirmed the 7 non-functional requirements and gave them numbers: RPO 5 min, RTO 1 hour, scan < 200 ms, bill save < 1 s.
- **Why / what I learned:** "Fast" and "safe" can't be tested; numbers can. RPO and RTO are the standard way to state data-safety goals.
- **Say it in an interview:** "My top requirement was zero data loss, so I defined it as RPO 5 minutes and RTO 1 hour, and chose a database setup that meets it."
- **Follow-ups to expect:** How do you prove your backups work? (Monthly restore drill — an untested backup doesn't count.)

### 2026-10-29 — Online-first instead of offline billing `#architecture` → ADR 0001
- **What happened:** Chose online-first for v1, with the data designed so offline can be added later.
- **Why / what I learned:** Offline sync across several counters is where stock goes wrong and data gets lost. UUIDs created at the source and idempotency keys keep the door open.
- **Say it in an interview:** "I traded availability during outages for correctness, because correctness was the top requirement, and designed the IDs so offline is possible later."
- **Follow-ups to expect:** How would you add offline? (Local store per counter, a separate invoice series per counter, sync of append-only events.)

### 2026-10-29 — Idempotency keys `#backend` `#architecture`
- **What happened:** Every "create" request from the screen (bill, payment) carries a unique key. A retry with the same key returns the first result.
- **Why / what I learned:** Networks fail *after* the server saved but *before* the reply arrived. Without a key, the retry makes a second bill.
- **Say it in an interview:** "Retries are only safe if the operation is idempotent; payment APIs like Stripe use the same idea."
- **Follow-ups to expect:** Where do you store keys and for how long?

### 2026-10-29 — Chose TypeScript everywhere `#architecture` → ADR 0002
- **What happened:** Compared TypeScript (NestJS), Python (FastAPI) and Java (Spring Boot) backends.
- **Why / what I learned:** The safety requirements come from PostgreSQL in every option. So the language decides speed of building, and TypeScript lets the counter screen and server share types, validation and GST math.
- **Say it in an interview:** "The database gives me correctness; the language gives me speed. Shared code means a GST rule exists once."
- **Follow-ups to expect:** Node is single-threaded — how do you handle heavy work? (A separate worker process.)

### 2026-10-29 — Single-page app, not Next.js `#frontend` → ADR 0003
- **What happened:** Chose React + Vite as a single-page app.
- **Why / what I learned:** Server-side rendering helps SEO and first load for public pages. A logged-in counter app has neither need, and SSR adds a server to run.
- **Say it in an interview:** "I picked the tool for the job: no SEO need, so no server rendering — the app is static files on a CDN."
- **Follow-ups to expect:** When *would* you use Next.js?

### 2026-10-29 — Modular monolith, not microservices `#backend` → ADR 0004
- **What happened:** One NestJS app split into modules that mirror the requirement modules (00–09), with one deployable image and two entry points (api, worker).
- **Why / what I learned:** Microservices solve team-scaling problems I don't have, and break the single transaction a bill needs.
- **Say it in an interview:** "Microservices are an organisational tool. For one developer and one database, a modular monolith gives the same boundaries without distributed transactions."
- **Follow-ups to expect:** How do you stop modules reaching into each other's tables?

### 2026-10-29 — PostgreSQL + Drizzle `#database` → ADR 0005
- **What happened:** Chose PostgreSQL, with Drizzle ORM and SQL migration files in git.
- **Why / what I learned:** Needed transactions, row locks, Row-Level Security, constraints and fuzzy search. MongoDB's model fits documents, not bills with lines and ledgers. Drizzle stays close to SQL, so locks and policies are easy.
- **Say it in an interview:** "Relational data with strict money rules belongs in a relational database with real transactions."
- **Follow-ups to expect:** Prisma vs Drizzle? How do you run migrations without downtime?

### 2026-10-29 — Multi-tenancy with Row-Level Security `#database` `#security` → ADR 0006
- **What happened:** Compared database-per-business, schema-per-business, and shared tables with `business_id` + RLS. Chose shared + RLS.
- **Why / what I learned:** Shared tables are cheap and simple, and RLS makes the database enforce separation even if code has a bug. Gotchas: table owners and superusers bypass RLS, so the app must connect as a separate role. Use `set_config('app.business_id', $1, true)` (transaction-local), because `SET` can't take query parameters.
- **Say it in an interview:** "Defense in depth: my code filters by business, and the database filters again, so one forgotten `WHERE` can't leak data."
- **Follow-ups to expect:** What about connection pooling with session variables? (Transaction-local settings work with transaction pooling.)

### 2026-10-29 — "No deletes" is enforced by the database, not just code `#database` → ADR 0007
- **What happened:** The app's database role gets no `DELETE` permission on business tables, and only `INSERT` + `SELECT` on the entry log. Stock is a ledger of movements, not a number that gets overwritten.
- **Why / what I learned:** Code has bugs, so the last line of defense should be the database. Corrections are reversals with a reason, like accounting.
- **Say it in an interview:** "Even a bug in my code can't delete a bill, because the database user doesn't have the permission."
- **Follow-ups to expect:** How do you handle a privacy request to erase a customer? (Anonymise the personal fields, keep the financial record — to decide later.)

### 2026-10-29 — Invoice numbers under GST `#gst` `#database`
- **What happened:** Learned that GST rules (CGST Rule 46) require invoice numbers to be consecutive and unique per financial year, in one or more series. Chose a counter row per branch per financial year, locked inside the bill transaction.
- **Why / what I learned:** `MAX(number) + 1` breaks with two counters (both read the same max). A locked counter row gives no duplicates and no gaps. Lock stock rows in a fixed order (by item ID) so two bills can't deadlock.
- **Say it in an interview:** "Sequential numbering under concurrency is a classic race condition; I solved it with a row lock inside the same transaction."
- **Follow-ups to expect:** Why not a database sequence? (Sequences skip numbers when a transaction rolls back — gaps aren't allowed.)

### 2026-10-29 — Money as integer paise `#money` → ADR 0008
- **What happened:** All amounts are whole paise in a `bigint`, tax rates are basis points (18% = 1800), and rounding lives in one shared, tested module.
- **Why / what I learned:** `0.1 + 0.2 = 0.30000000000000004` in floating point. JavaScript numbers are exact up to 2^53, which is about ₹90 lakh crore in paise, so plain numbers are safe.
- **Say it in an interview:** "I never let a float touch money. Integers in the smallest unit, explicit rounding rules in one place."
- **Follow-ups to expect:** How do you split ₹100 three ways? (Allocate the leftover paisa deliberately.)

### 2026-10-29 — Sessions instead of JWTs `#security` → ADR 0009
- **What happened:** Logins create a session row in PostgreSQL. The browser holds only a random token in an httpOnly cookie. Passwords are hashed with Argon2id.
- **Why / what I learned:** Needed instant revocation (staff leaves, owner auto-lock, permission change). JWTs are hard to revoke before expiry.
- **Say it in an interview:** "JWTs are great for stateless services; for a shared shop computer where access must stop instantly, server sessions are the safer choice."
- **Follow-ups to expect:** CSRF with cookies? Where should a JWT be stored if used?

### 2026-10-29 — Outbox pattern for WhatsApp, jobs in PostgreSQL `#backend` → ADR 0010
- **What happened:** Background jobs run in pg-boss (a queue stored in PostgreSQL). Messages are written to an outbox in the same transaction as the action, then sent by the worker. A real WhatsApp Cloud API integration uses Meta's free test number, plus an in-app Outbox page.
- **Why / what I learned:** Sending a message directly inside a request either loses it (crash after commit) or sends it for a rolled-back action. The outbox fixes both. Using PostgreSQL as the queue avoids running Redis.
- **Say it in an interview:** "Fewer moving parts: the database I already back up is also my queue."
- **Follow-ups to expect:** At-least-once delivery means duplicates — how do you handle them? (Idempotent sending by message ID.)

### 2026-10-29 — AWS cost traps `#cloud` `#cost` → ADR 0011
- **What happened:** First plan: ECS Fargate + load balancer + RDS + CloudFront, assuming ₹1,000/month.
- **Why / what I learned:** Cost traps for students: a NAT gateway (~$35–45/month just to exist), EKS (~$73/month for the control plane), public IPv4 addresses ($0.005/hour each since 2024), load balancers, and forgotten environments. Secrets Manager charges per secret per month; SSM Parameter Store standard parameters are free.
- **Say it in an interview:** "Because everything is Terraform, I can destroy and recreate an environment in minutes, so it only uses credits while it runs."
- **Follow-ups to expect:** How do you avoid a NAT gateway? (Public subnet with a tight security group, or VPC endpoints.)

### 2026-10-29 — Redesigned hosting for a ₹0 budget `#cloud` `#cost` `#architecture` → ADR 0011
- **What happened:** I told Claude I have no monthly budget and will use an AWS Free plan account. We read the official rules: up to $200 credits over 6 months, "You won't be charged unless you convert to a Paid plan", and the account closes after 6 months or when credits run out. The Fargate + load balancer design (~$45–55/month) would have closed the account in about 4 months. New design: one EC2 server running Docker Compose (Caddy + api + worker) + RDS with point-in-time restore + a nightly `pg_dump` to S3, about $25–35/month.
- **Why / what I learned:** Design to the real constraint. Keep the part that protects the top requirement (managed backups) and cut what only adds scale (load balancer, ECS). Time the 6-month window to placement season. Because the demo data is a seed and the infrastructure is Terraform, the account closing loses nothing.
- **Say it in an interview:** "I sized the architecture to a zero budget without giving up point-in-time restore, and because it's all containers and Terraform, scaling to ECS behind a load balancer is an infrastructure change, not an app change."
- **Follow-ups to expect:** What breaks first if traffic grows 100×? (The single server: add a load balancer and more instances, or move to ECS.) Why not run PostgreSQL on the EC2 to save more? (Then I'd own backups and PITR, the riskiest thing to self-manage.)

### 2026-10-29 — Checked the laptop before installing anything `#devops` `#gotcha`
- **What happened:** Claude checked what was installed: Git, GitHub CLI, Node 24 (LTS) and VS Code were there; pnpm, Docker, WSL and Terraform were missing. Two gotchas: Windows reported "virtualization disabled", but that's what it says when a hypervisor is *already* running (it was enabled). And an `aws` command existed but was a broken old pip install of AWS CLI v1.
- **Why / what I learned:** Docker Desktop on Windows runs Linux containers inside WSL 2, so WSL comes first. Verify tools by running them, not by checking that the command exists.
- **Say it in an interview:** "Before setting up, I audited the machine: what's installed, which versions, what's broken."
- **Follow-ups to expect:** What is WSL 2? Why do Linux containers need a Linux kernel?

### 2026-10-29 — "LF will be replaced by CRLF" warnings `#git` `#gotcha`
- **What happened:** Git on Windows warned that line endings would be converted, because Windows uses CRLF and Linux uses LF. Planned fix in P0.1: a `.gitattributes` file with `* text=auto eol=lf`.
- **Why / what I learned:** The code runs in Linux containers and on Linux CI. Mixed line endings break shell scripts (`/bin/sh^M: bad interpreter`) and create noisy diffs.
- **Say it in an interview:** "I pinned line endings in `.gitattributes` so Windows and Linux machines produce identical files."
- **Follow-ups to expect:** What does `core.autocrlf` do?

### 2026-10-29 — Rewrote commit messages and force-pushed safely `#git`
- **What happened:** Both commits had an AI co-author line, and I wanted the history to show only me. Removed it with `git filter-branch --msg-filter`, then pushed with `git push --force-with-lease=main:<old commit>`. Added a rule to `CLAUDE.md`: no AI attribution in commits.
- **Why / what I learned:** Rewriting history changes every commit hash after the change, so the remote must be force-updated. `--force-with-lease` only overwrites if the remote still points where I expect, so it can't wipe someone else's newer work the way plain `--force` can. Only do this on branches nobody else uses. Modern tool: `git filter-repo`.
- **Say it in an interview:** "I never use plain `--force`; `--force-with-lease` checks the remote first, and I only rewrite history on branches I own."
- **Follow-ups to expect:** `git revert` vs `git reset` vs rewriting history? Why not rewrite a shared `main`?

### 2026-10-29 — How I (and Claude) get into AWS: SSO, not access keys or console clicking `#cloud` `#security` `#devops`
- **What happened:** I asked whether Claude would work in AWS through the browser. Plan: I create the account and an admin login in IAM Identity Center in the browser, once. After that, `aws sso login` opens the browser for approval and gives my laptop temporary credentials. Claude runs `aws` and `terraform` commands in my terminal with those credentials, always `terraform plan` first and `apply` only after I approve.
- **Why / what I learned:** Clicking in the console isn't repeatable or reviewable; infrastructure as code is. SSO credentials expire after a few hours, so there are no long-lived access keys to leak, and access stops when the session ends. The root user is only for account-level tasks, protected by MFA.
- **Say it in an interview:** "Nobody, including my AI assistant, has permanent AWS keys. Everything goes through short-lived SSO sessions and Terraform plans I review."
- **Follow-ups to expect:** What's the difference between an IAM user, a role and Identity Center? Why never use the root account?

### 2026-10-29 — One domain for app and API, so cookies work `#security` `#frontend` `#gotcha` → ADR 0011
- **What happened:** The first plan served the web app from CloudFront and the API from a different host. With session cookies (ADR 0009) that breaks: the browser treats the API as another site and won't send `SameSite` cookies on its requests. Fixed by having Caddy serve the web app *and* forward `/api` on one domain. Locally, Vite's dev server proxies `/api` the same way.
- **Why / what I learned:** Same-origin hosting avoids both CORS setup and cross-site cookie problems.
- **Say it in an interview:** "Cookie-based auth shaped my hosting: app and API share one origin, so there's no CORS and no third-party cookie issue."
- **Follow-ups to expect:** What's the difference between same-site and same-origin? What does `SameSite=Lax` allow?

### 2026-10-29 — GitHub Actions with OIDC `#devops` → ADR 0012
- **What happened:** CI on every push/PR. After a merge, the deploy runs through AWS Systems Manager on the EC2 server (no SSH port open), with a health check and rollback to the previous image. AWS access uses OIDC, so no keys are stored in GitHub.
- **Why / what I learned:** Long-lived cloud keys in CI are a top cause of leaks. Jenkins would need its own server to run and patch. GitHub plan gotcha: on private repos, deployment approvals (required reviewers) need GitHub Enterprise; on public repos they're free.
- **Say it in an interview:** "My pipeline has no stored AWS secrets; each run gets short-lived credentials for one role."
- **Follow-ups to expect:** How do you roll back a bad deploy?

### 2026-10-29 — Testing against a real PostgreSQL `#testing` → ADR 0013
- **What happened:** Vitest for business rules, Testcontainers for integration tests on real PostgreSQL, and Playwright for end-to-end flows.
- **Why / what I learned:** Locks, concurrency and RLS can't be tested with mocks or SQLite. NestJS defaults to Jest; using Vitest needs the SWC plugin so decorators keep their metadata.
- **Say it in an interview:** "I wrote a test where two simulated counters sell the last unit at once — that bug only shows against the real database."
- **Follow-ups to expect:** Test pyramid? How long does your CI take?

### 2026-10-29 — Hindi PDFs need text shaping; one-key printing `#frontend` `#gotcha` → ADR 0014
- **What happened:** Chose browser printing with print stylesheets (80 mm, 58 mm, A4), Chrome's `--kiosk-printing` flag for no print dialog, and headless Chromium for PDFs.
- **Why / what I learned:** Devanagari letters combine (क + ष = क्ष). Many JavaScript PDF libraries don't do this "text shaping" and print broken Hindi. A browser engine does it right.
- **Say it in an interview:** "Supporting Hindi was more than translations: I had to pick a PDF pipeline that shapes Devanagari correctly."
- **Follow-ups to expect:** How do barcode scanners work with a web app? (They act as a keyboard.)

### 2026-10-29 — AI uses tool calling, not text-to-SQL `#ai` → ADR 0015
- **What happened:** The assistant may only call a fixed set of my own functions, which run with the asking user's permissions. It never writes SQL.
- **Why / what I learned:** Model-written SQL can bypass staff permissions (salaries, profit) and produce silently wrong joins. Functions are testable, and every number comes from them.
- **Say it in an interview:** "The model decides *which* question to ask; my code decides *what it's allowed to see* and computes the numbers."
- **Follow-ups to expect:** How do you evaluate the AI's accuracy? (An eval set of questions with known answers from demo data.)

### 2026-10-29 — A Claude subscription is not an API key `#ai` `#cost` `#gotcha`
- **What happened:** I planned to use my Claude subscription for the app's AI. Learned that Pro/Max subscriptions cover claude.ai and Claude Code only. An app needs an API key from the Claude Console, billed separately (prepaid credits, with a spend limit).
- **Why / what I learned:** Consumer subscriptions and developer APIs are different products. Rough cost: a question of ~10k input + 1k output tokens costs about $0.0015 on Haiku 5.5, $0.03 on Sonnet 5.5, or $0.06 on Opus 5.5 (prices cached 2026-10-06). A few dollars of credit covers a demo.
- **Say it in an interview:** "I estimated cost per question before building and put a hard monthly cap in the app."
- **Follow-ups to expect:** How would you cut AI cost? (Prompt caching, smaller model for simple questions.)

### 2026-10-29 — Demo data generated through the app's own code `#testing` → ADR 0016
- **What happened:** A seed script with a fixed random seed builds a realistic demo shop by calling the same services the app uses. A first version comes at the end of Phase 1.
- **Why / what I learned:** Inserting rows directly can create impossible states (stock not matching movements). Going through services makes the demo obey every rule and doubles as a big test.
- **Say it in an interview:** "My demo data is reproducible and rule-abiding because it's created by the real business logic."
- **Follow-ups to expect:** How do you reset the demo?

### 2026-10-29 — GST treats branches in different states as separate businesses `#gst` `#gotcha`
- **What happened:** Noticed that moving stock between branches with different GSTINs is a taxable supply under GST (distinct persons), which needs a tax invoice with IGST, not just a stock movement. Added it as an open question to Module 01.
- **Why / what I learned:** Domain rules can turn a "simple" feature into an accounting event. Check the law before modelling it.
- **Say it in an interview:** "Branch transfers looked like an inventory feature, but across states they're a GST invoice. I caught it in design, not in production."
- **Follow-ups to expect:** —

### 2026-10-29 — Found contradictions in the requirements before building `#requirements`
- **What happened:** In the kickoff, flagged that (1) medical costing (oldest-first) and billing order (expiry-first) can pick different batches, (2) "one shared counter computer" vs "several counters", and (3) Module 06 asks whether the owner's actions are logged although Module 00 already says every action is. Each is now an open question in its module file.
- **Why / what I learned:** Reading requirements critically before coding is cheaper than fixing code later.
- **Say it in an interview:** "I review requirements for contradictions first; it's the cheapest bug to fix."
- **Follow-ups to expect:** —
