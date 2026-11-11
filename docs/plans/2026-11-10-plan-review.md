# Plan and technology review — 2026-11-10

**Why:** the owner asked, before pushing the deep-scan fixes, for a review of the whole plan: is every technology the right one, does it actually work the way the plan assumes, and what should change.

**How:** nothing here is from memory alone. Each verdict rests on one of:

- **Ran it:** an experiment on this laptop (a throwaway PostgreSQL 18, an ARM64 build, a spike test).
- **Installed:** what is in `node_modules` and passes the 272 tests.
- **Registry:** `npm view`, `pnpm outdated`, `pnpm audit` on 2026-11-10.
- **Read:** an official page or changelog, read on 2026-11-10 (links at the end).

**Short answer:** the stack is right and nothing needs replacing. Four assumptions in the plan were wrong or untested, and are now corrected in the files (section 2). The biggest risk was not a technology. It was the **order of work** against the AWS 6-month clock and placement season, and the owner changed it the same day (section 4).

## 1. Verdict on each technology

| Area | Choice | Verdict | Evidence |
| --- | --- | --- | --- |
| Language and repo | TypeScript, pnpm workspace | Keep | Installed: 272 tests, lint and build green. Registry: only minor updates waiting. |
| TypeScript version | pinned `~6.0` | Keep the pin | Registry: TypeScript 7.0.2 is out, but `typescript-eslint` 8.72 still requires `<6.1.0`. |
| Web app | React 19, Vite 8, TanStack Router and Query, Tailwind 4 | Keep | Installed: 130 web tests; the built app runs under a strict CSP. |
| API | NestJS 12 on Express 5 | Keep | Installed. Ran it: class injection by constructor type works in Vitest with no extra plugin (2.3). |
| Database | PostgreSQL 18 with Row-Level Security | Keep | Ran it: 18 attacks as the app's role, isolation held. Read: RDS offers PostgreSQL 18 (18.4 today). |
| ORM | Drizzle 0.45 | Keep; stay off 1.0 for now | Registry: `latest` is 0.45.4; 1.0 is still a release candidate (rc.5). ADR 0019's "don't build on a release candidate" still holds. |
| Job queue | pg-boss 12 with its own role | Keep, with one setting | Ran it on PostgreSQL 18.6: fails as planned, works with `createSchema: false` (2.1). |
| Passwords | Argon2id | Keep; prefer Node's built-in | Ran it: `crypto.argon2` exists in Node 24 on the laptop and in the ARM64 image, so no native package is needed (2.4). |
| Sessions | Server-side, in PostgreSQL | Keep | Design review. The scan's notes on token hashing and lookups are under P1.4. |
| Web server | Caddy | Keep | Ran it: same headers on x86 and ARM64. |
| CI | GitHub Actions, five required checks | Keep | Read: ARM64 runners are free for public repos, which the deploy stage needs (2.2). |
| Hosting | AWS Free plan: EC2 `t4g.small` + RDS, Terraform | Keep | Read: `t4g.small` is one of six instance types a Free plan account may launch. Ran it: our images run on ARM64. |
| PDFs | Headless Chromium in the worker | Keep, measure early | Not tested yet. Risk: memory on a 2 GB server (section 5). |
| WhatsApp | Cloud API test number | Keep | Not tested yet (Phase 2). The log-only sender and the Outbox page make the demo work without it. |
| AI | Claude API with tool calling | Keep | Model and cap are chosen at Phase 3, as planned. |
| Dependencies | — | Healthy | Registry: `pnpm audit --prod` finds nothing. Three *moderate* advisories, all in development tools (ESLint's and Testcontainers' `minimatch`/`glob`), none in what ships. |

## 2. What the experiments found

### 2.1 pg-boss can't start the way ADR 0022 describes

ADR 0022 gives pg-boss a role, `app_queue`, that owns only the schema `pgboss` and has no other rights. On a throwaway PostgreSQL 18.6 set up exactly that way, `boss.start()` failed:

```
permission denied for database business_software
```

pg-boss runs `CREATE SCHEMA IF NOT EXISTS pgboss` at start. PostgreSQL checks the right to create schemas *before* it checks whether the schema exists, so the statement is refused even though the schema is already there.

**Fix:** start pg-boss with `createSchema: false`. With that one option everything worked as `app_queue`: start, a plain queue, a partitioned queue (which creates a table at run time), send, work, schedule, stop. The boundaries held both ways: `app_queue` could not read a table in `public` or create one there, and `app_runtime` could not read `pgboss`. pg-boss needs no extension and has no `SECURITY DEFINER` functions.

The decision in ADR 0022 stands. Without this test, P2.7 would have hit the error and the tempting "fix" would have been to give the queue role `CREATE` on the database.

### 2.2 The server is ARM64, and CI builds x86 images

ADR 0011 chose a Graviton server (`t4g.small`), which has an ARM64 processor. CI builds both images on `ubuntu-latest`, which is x86. An x86 image doesn't run on an ARM64 server (`exec format error`). Nothing in the plan mentioned this.

**Checked:** both images build for `linux/arm64` unchanged, the API answers `/api/health` on `aarch64` as the non-root user, and Caddy serves the app with the same headers. No dependency of ours has native code, which is why it just works.

**Plan:** the deploy stage builds and pushes the images on GitHub's ARM64 runner (`ubuntu-24.04-arm`, free for public repos) and runs the smoke test there too, so the image that was tested is the image that runs. Staying on Graviton is right: it's the cheaper server, and the credits are tight.

### 2.3 Tests don't need the SWC plugin

ADR 0013 said the API's tests would need an SWC plugin so that NestJS decorators keep their type metadata, and ADR 0020 said to check first. A spike test (a service injected by its constructor type, no `@Inject()` token) passed with Vitest 5 as it is. One fewer dependency; P1.3's services can use ordinary constructor injection.

### 2.4 Argon2id is built into Node 24

`crypto.argon2` works on the laptop (Node 24.18) and inside the ARM64 image (Node 24.22). That matters here: pnpm is set to refuse install scripts, and the slim image has no compiler, so a native package would have been friction. It returns raw bytes, so we store the salt and parameters with the hash ourselves and test against the published test vectors. P1.4's auth ADR decides between this and a library.

### 2.5 Hindi sorting is available

The `postgres:18` image ships 871 ICU collations, including `hi-x-icu` and `und-x-icu`. P1.7 can pick one for item names; the same names must be checked on RDS (ADR 0019).

## 3. Changed in the files today

- **ADR 0022:** a dated note with the `createSchema: false` finding.
- **ADR 0013:** a dated note that the SWC plugin isn't needed.
- **ADR 0011:** a dated note on ARM64 images and the instance types a Free plan account may launch.
- **`PROGRESS.md`:** the facts above under P1.3, P1.4, P1.7, P1.15, P2.7, stage 5 and stage 6; a small dependency-refresh task; and Phase 1 re-ordered (section 4).
- **`START_HERE.md`:** said the repo is private. It has been public since 2026-10-30.

No decision in any ADR was changed, and no DECIDED requirement was touched.

## 4. The order of work: changed to demo-first

**Decided 2026-11-10.** The owner chose the order proposed below, and said placement interviews are 1 to 3 months away. `PROGRESS.md`'s Phase 1 now follows it. Task numbers and requirements are unchanged.

**The problem.** Today's order is: signup, login, staff permissions, branches, items, stock, Excel import, batches and IMEI, transfers; *then* the cloud stages; *then* billing. Three things follow from that:

1. The AWS account's 6 months start the day it is opened (stage 4, now). The first deploy would come about a dozen sessions later. Those weeks of the clock buy nothing.
2. Billing is what the project is about, and it comes after nine other feature tasks. If placement season arrives first, the demo is a login screen and an items list.
3. DevOps is the second goal of the project. A pipeline that deploys only at the end has shipped once. One that deploys from the start has shipped every feature, which is the stronger story and the better practice.

**The proposal: demo-first order.** Same tasks, same requirements, different order.

1. **Cloud first:** stage 4 (account) → stage 5 (Terraform: network, server, database, HTTPS) → stage 6 (deploy on merge) → stage 7 (backups and a restore drill). The skeleton goes live, and every merge after that ships.
2. **The shortest path to a printed bill:** P1.3 signup → P1.4 login → P1.7 items → P1.8 stock ledger → finalize Module 02 → P1.12 GST engine → P1.13 billing screen → P1.14 saving a bill → P1.15 printing.
3. **Make it showable:** finalize Module 03 → P1.18 udhaar ledger → P1.20 demo data and the demo login.
4. **Then the rest of Phase 1:** P1.5 staff logins and permissions, P1.6 branches, P1.9 Excel import, P1.10 batches, variants and IMEI, P1.11 transfers and stock count, P1.16 credit notes, P1.17, P1.19.

**What makes the deferrals safe:**

- *Permissions (P1.5) later:* P1.4 builds the route guard anyway, and from the first route every endpoint names the permission it needs. The owner has them all. P1.5 then only adds staff logins and the switches; no route is retrofitted.
- *Branches (P1.6) later:* signup already creates one branch, and the guard test already forces every branch-level table to carry `branch_id`. P1.6 adds the screens.
- *Batches and IMEI (P1.10) later:* P1.8 designs the stock ledger with room for a batch, and the demo shop is a kirana store (ADR 0016), which needs none of them to sell.

**What it costs:** running the server and database from the start uses credits sooner, roughly $30 a month. Six months is about $180 of the $200, so the extra $100 of credits must be earned, and stage 7's "stop when idle" schedule matters from the first week.

**Also worth deciding at the end of Phase 1:** a thin slice of the AI assistant (three or four read-only tools over bills and udhaar) right after demo data v1, before Phase 2. It is the most distinctive feature and currently the very last thing built.

## 5. Risks to measure, not guess

| Risk | When it is measured |
| --- | --- |
| Chromium, api, worker and Caddy in 2 GB of memory | P1.15: render a PDF while a bill saves; add swap or give the worker its own image if needed |
| ADR 0014 puts Chromium in the worker; ADR 0020 has one image for api, worker and migrate | P1.15: decide whether the worker gets its own build target, so the api image stays small |
| Amazon SES starts in a sandbox (200 emails a day, only to verified addresses) and needs a real domain's DNS records | P1.4's email ADR. The design already survives undelivered email: recovery key, confirm-later banner |
| The free domain: the Student Pack is still awaiting approval | Stage 5. DuckDNS works for HTTPS, not for SES |
| WhatsApp's test number rules | P2.8 |

## Sources

- AWS EC2 User Guide, *Track your Free Tier usage*: instance types for accounts created on or after 2025-07-15 — https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html
- AWS, *Amazon RDS for PostgreSQL now supports major version 18* — https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-rds-postgresql-major-version-18
- AWS RDS release notes, PostgreSQL versions — https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html
- GitHub changelog, *arm64 hosted runners for public repositories are now generally available* — https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/
- AWS SES documentation, *Request production access* — https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
- npm registry on 2026-11-10: `drizzle-orm` (`latest` 0.45.4, `rc` 1.0.0-rc.5), `typescript-eslint` 8.72.2 (peer `typescript <6.1.0`), `pg-boss` 12.38.1
