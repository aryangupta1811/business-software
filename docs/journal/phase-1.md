# Phase 1 — Core selling

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-11-01 (P1.1 tenancy & data safety):** the first tables, `businesses` and `branches`, with Row-Level Security forced on, so even the owner role is filtered. The app reaches business data only through `withBusiness` (or `withNewBusiness` at signup), which sets the business for one transaction with `set_config(…, true)`. No business set means no rows and no inserts. A pooled connection reused after a transaction sees nothing, and a test proves it. IDs are UUIDv7 from PostgreSQL 18's `uuidv7()`. Signup sets the new business's ID before inserting it, so it passes the same policy with no bypass. A guard test reads PostgreSQL's catalogue and fails CI if any table breaks one of 8 rules (RLS, `FORCE`, the one correct policy, `business_id`, grants, business-scoped foreign keys, no materialized views); 16 probe tables prove it. The design was approved section by section; a fresh review found three leaks past the first guard and two `FORCE` traps (data migrations, `pg_dump`), all fixed or written down. 241 tests. ADR 0027.
- **2026-11-02 (P1.2 entry log recording):** the audit log, built before any feature changes data so no history is missing. One tenant table, `entry_log`, that the app's database user can only insert into and read: the migration revokes UPDATE, and DELETE was never granted. Each row has who (`actor_id`, NULL = the system; the key to users waits for P1.4), what (`action`, `entity_type`, `entity_id`), why (`reason`) and old → new (`before`/`after` JSON). One helper, `recordEntry(tx, entry)`, takes a transaction, not the database, so the row commits or rolls back with its action; it refuses a stock adjustment without a reason and a missing actor. The guard grew from 8 to 11 table rules plus function and role checks, now over every schema and over effective (inherited and column-level) rights, proven by 28 probes. A fresh review found five more ways to reopen the log or leak data, all fixed test-first. 262 tests. ADR 0028.
- **2026-11-02 (Module 00 open questions, no code):** settled the rules signup and login depend on, before designing their tables.
  - Owner auto-lock: 5 minutes, settable from 1 to 30. A staff session ends after 30 idle minutes.
  - The owner logs in with email. Staff log in with a username that only has to be unique within the shop, because the counter computer remembers which shop it belongs to.
  - A forgotten owner password is reset by an email link or a printed recovery key. The owner resets staff passwords.
  - Staff who leave are deactivated, never deleted. Each staff member has one home branch.
  - Signup gained the owner's email (6 fields).
- **2026-11-10 (deep scan, before opening the AWS account):** a full read of the code, the migrations, the pipeline and the plan, plus 18 attacks on a live database as the app's own role. Tenant isolation and the no-delete rules held. Four bugs were in how the API fails, not in what it does, and each got a failing test first:
  - A database connection lost in the middle of a transaction crashed the whole API process.
  - Any request failing on a query would have logged the query's values (customers' data), because Nest's default error handler logs the error object.
  - An error nothing caught was printed by Node as a whole object, skipping the messages-only rule.
  - The log gave no reason at all when `localhost` refused the connection.

  The plan had gaps too, now filed under their tasks in `PROGRESS.md`: the worker can't see any business's rows without a cross-business read; the public demo login and its "reset" clash with the no-delete rule; login isn't the only lookup that happens before a business is known. 272 tests.
- **2026-11-10 (plan and technology review, no feature code):** every technology checked with evidence (`docs/plans/2026-11-10-plan-review.md`). The stack stays. Experiments corrected four assumptions: pg-boss needs `createSchema: false` to run as its restricted role; the Graviton server is ARM64 while CI builds x86 images (both images were built and run on ARM64); tests don't need the SWC plugin; Argon2id is built into Node 24. The order of work changed to **demo-first**: cloud stages 5, 6 and 7 before any feature, then the shortest path to a printed bill, then demo data, then the rest.
- **2026-11-12 (DevOps stage 4, cloud guardrails, no code):** the owner opened the AWS account and Claude checked it in the console (read-only, except one budget). Free plan, $100 of credits until 2027-05-12, nothing running. The account came from AWS's new projects-based sign-up experience. It has no IAM users for people, and the Free plan project is locked to **Sydney**, so the runbook written for the old experience no longer fitted. To keep the project fully free, the owner chose Sydney over an irreversible upgrade. A $15 monthly budget alerts on real spend, with credits filtered out. ADR 0030 replaces ADR 0029, and the runbook was rewritten.
- **2026-11-12 (DevOps stage 5 part 1, prep, no resources created):** AWS CLI v2 and Terraform installed. The laptop signs in with `aws login` (temporary credentials from the console session, no access keys; ADR 0031). Checked in Sydney that the server type, PostgreSQL 18.6 and Ubuntu 26.04 ARM64 are available; priced every resource with the Pricing API ($0.0512 per running hour + $4.73 a month); measured 0.2 s extra latency from India. The owner chose an auto-assigned IP with DuckDNS, Ubuntu, and a nightly stop (ADR 0032). The Terraform plan for parts 2 and 3 waits for the owner's OK.
- **2026-11-18 (DevOps stage 5 part 3, the skeleton live, PR #26):** https://business-software.duckdns.org serves the app over HTTPS (Caddy, Let's Encrypt), with the database on RDS.
  - ARM64 images are built on GitHub Actions for every commit on `main` and stored on GHCR, tagged by the commit hash.
  - A deploy is one Systems Manager Run Command: the server fetches the repo at that commit and runs its install script. No SSH.
  - App passwords and the DuckDNS token are SSM SecureStrings that Terraform writes but never stores.
  - The RDS admin isn't a superuser, so the roles script switches to `app_owner` for its grants, and a new test runs it as a non-superuser.
  - A stop and start brought the site back on a new IP in 73 s. ADR 0034.
- **2026-11-18 (P1.12 GST engine, PR #25):** one pure function computes every number on a bill (inclusive and exclusive prices, CGST+SGST or IGST, composition, item and bill discounts, round-off) in whole paise, plus Indian state codes. Owner's answer: a ₹X bill discount means the customer pays exactly ₹X less.
- **2026-11-19 (P1.3 Signup & business setup, PR #27):** signup creates the business, its head-office branch, the owner (Argon2id, ADR 0035) and a recovery key shown once, in one transaction with an entry-log row. The settings page and API save business, feature and lock-time settings, logging only what changed. Every route must declare a permission or `@Public()`, and a census test proves it (ADR 0036). Two reviews and a real-app check found 13 problems, all fixed test-first. 1,082 tests.
- **2026-11-19 (fast track Day 3: sitting 2, P1.7, P1.4 PR 1, stage 7; PRs #30–#34):** three lanes ran at once as background agents, each in its own git worktree, merged one at a time.
  - **Sitting 2:** Modules 05–07 decided in about an hour; D4 means only the database sets an entry log row's ID and time.
  - **P1.7 Items:** six tenant tables (items, packs, barcodes, categories, own units, per-branch low-stock levels), an `item_name` ICU collation, an API with versioned saves (`409 stale`), barcode lookup and in-store EAN-13 codes, and the Items page with scanner input. The guard gained rules for unique keys, unvalidated foreign keys and schema access.
  - **P1.4 Login, PR 1:** owner by email, staff by username on a remembered counter computer; sessions stored as hashes; the one cross-business lookup in a schema the app can't touch (ADRs 0038–0039); lock screen, CSRF, rate limits counted before hashing.
  - **Stage 7 backups:** the RDS master can't bypass RLS, so a read-only `app_backup` role reads every tenant table through its own policy; nightly dumps go to an S3 bucket that refuses overwrites; a restore drill compares row counts (ADR 0037).
  - Every PR got a code review (high): 39 findings across four PRs, all fixed test-first. 1,399 tests.
- **2026-11-20 (fast track Day 4, first half: stage 6, P1.4 PR 2, P1.8 PR 1; PRs #35, #37, #38):** three lanes again, merged one at a time.
  - **Stage 6 CD:** a merge to `main` starts a deploy that waits for the owner's approval in the GitHub `demo` environment (only `main` may use it), signs in to AWS through OIDC with no stored key, backs up first, deploys one commit over Run Command, checks health and rolls back. A repository variable, `DEPLOY_HOLD`, stops every run unless it is exactly `off`. Two reviews found 18 problems (among them a job timeout that skipped the rollback, credentials expiring before a rollback, two installs overlapping); 41 script checks with fake `aws` and `curl` now run in CI. Applied: 3 IAM resources, $0.
  - **P1.4 PR 2:** email confirmation, password reset by link and by recovery key, a new recovery key, change password, remembered computers. Email goes through one interface: SES on the server with no password anywhere, Mailpit on the laptop (ADR 0040). The owner chose to limit recovery-key tries per IP only, so knowing an owner's email can't lock them out.
  - **P1.8 PR 1:** the stock ledger. Every change is a row in an append-only `stock_movements` table; `item_stock` holds the current quantity and average cost per item per branch; `moveStock` is the only code that writes either. Rows are locked in item order so two counters can't sell the same last unit or deadlock; database timeouts end a stuck wait with a `503` the screen retries (ADR 0041). The owner answered seven design questions.
  - Code reviews: 32 findings across three PRs. 1,576 tests on `main` after the three merges.

## Stack choices vs alternatives

| Area | Chose | Over | ADR |
| --- | --- | --- | --- |
| IDs | UUIDv7 from `uuidv7()` | UUIDv4, serial integers | 0027 |
| Where RLS policies live | In the Drizzle schema via `tenantPolicy()`; `FORCE` and the function hand-written in the migration | All hand-written SQL; an event trigger | 0027 |
| Setting the business | `withBusiness` / `withNewBusiness` with a transaction-local `set_config` | `SET LOCAL`; a bypass role for signup | 0027 |
| Keeping future tables safe | A catalogue guard test with probe tables | Code review and a checklist | 0027 |
| Who did it, before users exist | Nullable `actor_id`, key added in P1.4 | A minimal users table now; a free-text name | 0028 |
| Old → new values | Two jsonb columns, `before` and `after` | One row per changed field; a precomputed diff | 0028 |
| Action names | Text column + a TypeScript list | A database enum (a migration per new action) | 0028 |
| Owner password reset (product rule) | Email link + printed recovery key | SMS OTP (per-message cost, DLT registration); recovery key only | Module 00 #30–#33 |
| Staff login (product rule) | Username unique within the shop; the counter computer remembers the shop | A shop code typed at every login; usernames unique across the app | Module 00 #28 |
| AWS Region | Sydney `ap-southeast-2`, the Free plan project's assigned Region | Mumbai via the Paid plan + advanced features (irreversible, card chargeable); a second project in Mumbai (unknown if allowed) | 0030 |
| Cost alarm | AWS Budget on gross cost (Credit and Refund excluded), $15 a month, actual and forecast alerts | Default budget (credits hide spend); a Paid plan spend limit | 0030 |
| When to start the cloud | Now, running only for sessions and demos (~$10 a month) | AWS at the end (the 6-month clock runs anyway; no live demo for placements) | 0011, 0030 |
| Laptop sign-in to AWS | `aws login` with a named profile + `allowed_account_ids` | IAM user access keys; AWS's Agent Toolkit setup; IAM Identity Center (needs an Organization) | 0031 |
| Server's public address | Auto-assigned IPv4 + DuckDNS updated at boot | Elastic IP (billed even while stopped, $3.65 a month) | 0032 |
| Server OS | Ubuntu 26.04 LTS ARM64 | Amazon Linux 2023 (no automatic updates, Compose installed by hand) | 0032 |
| Forgotten-server guard | Nightly EventBridge Scheduler stop at 23:30 IST | A budget action (fires only after $15 is spent) | 0032 |
| Image registry | GHCR, public, pushed by the workflow's own token | Amazon ECR (billed storage, needs OIDC first); pushing from the laptop | 0034 |
| Deploying | Run Command by commit hash: the repo's files and the images at one hash | SSH and `git pull`; a deploy agent | 0034 |
| Password hashing | Argon2id from Node's built-in `crypto` | bcrypt; an argon2 npm package with native code | 0035 |
| Login email alphabet | Printable ASCII, in the schema and a database CHECK | Unicode normalisation (NFKC) plus look-alike detection | P1.3 review |
| Backups under forced RLS | A read-only `app_backup` role with its own `backup_read` policy on every tenant table, checked by the guard and by the dump script | `pg_dump` as the RDS master (can't bypass RLS); lifting `FORCE` during the dump | 0037 |
| Backups can't be destroyed | S3 bucket policy denies uploads without `If-None-Match: *`; the server may only add files | Plain `PutObject` (a taken-over server could overwrite history); S3 Object Lock | 0037 |
| Login by email before the business is known | One `auth.owner_logins` table the app can't read, reached by two pinned `SECURITY DEFINER` functions | A `BYPASSRLS` role; a global users table | 0039 |
| Sessions | Random token in a `__Host-` cookie carrying the business ID, stored as SHA-256 | JWTs (can't be revoked); plain tokens in the database | 0038 |
| History can't be backdated | Column-level INSERT grants: the database sets `entry_log.id` and `created_at` | A trigger that overwrites them silently; a seed-only role | D4, 0028 note |
| Who may deploy | GitHub environment `demo` (owner approves, `main` only) + OIDC role trusted only for that environment + `DEPLOY_HOLD` kill switch | An AWS access key in GitHub secrets; deploying every merge with no approval | 0012 note, stage 6 |
| Sending email | One Mailer interface: SES through the server's role, Mailpit locally, `none`, a fake in tests | SMTP with a stored password; a paid email API; no email at all | 0040 |
| Recovery-key brute force | Limit wrong keys per IP; a right key is never refused | Limit per email (anyone knowing the email can lock the owner out) | `00` #41 |
| Stock | Append-only movements + a balance row per item per branch, written only by `moveStock` | Summing movements on every read; editing a quantity column in place | 0007, P1.8 design |
| Two counters, one item | `SELECT … FOR UPDATE` in item-ID order, plus `lock_timeout` 3 s → `503` and one retry | SERIALIZABLE transactions and retry loops; advisory locks | 0041 |

## Mistakes and what I learned

- **My type rule didn't hold until a test checked it.** `withBusiness` must not accept a transaction (the setting would outlive a savepoint), and a `@ts-expect-error` test showed TypeScript accepted one anyway: types match by shape, not name. Narrowed the parameter to a type only a real pool has. Lesson: "this must not compile" needs a test too.
- **My guard only caught the attacks I had thought of.** The reviewer showed three more on a live database: an extra permissive policy (policies are ORed), single-column foreign keys (foreign-key checks skip RLS) and a materialized view (never filtered). Lesson: a fresh attacker finds what the author can't; add a failing probe for each before fixing.
- **A safety setting had side effects I hadn't written down.** `FORCE` filters the owner role, so a data migration as the owner changes 0 rows silently, and `pg_dump` as the owner fails or writes empty tables. Lesson: for every safety feature, ask what else it stops.
- **I committed the plan before scanning it.** Scanned the commit straight after (clean). Lesson: the scan goes before every commit, docs included.
- **"Can the app UPDATE this table?" has more than one answer.** My append-only check asked `has_table_privilege(…, 'UPDATE')`. The reviewer showed three other ways in: a column-level grant (`has_any_column_privilege` is true), a plain view (it checks rights as its owner, who owns the log), and a `SECURITY DEFINER` function granted to the app. Lesson: guard the outcome ("can app_runtime change a row?"), not the one grant I imagined.
- **A type isn't a runtime check.** `actorId: string | null` makes forgetting "who" a compile error, but untyped code can still pass `undefined`, which became NULL, meaning "the system". One line at runtime closes it.
- **A test helper pointed at the wrong database.** The superuser URL named the container's default database, so a schema probe "didn't exist". Lesson: when a setup step fails, check where it ran before changing the test.
- **The list of open questions wasn't complete.** Answering "how to reset a password" (by email) made email a login detail, and that exposed a question nobody had listed: what owners and staff type to log in. Lesson: after answering each question, ask what it changes downstream.
- **I had tested the idle half of a failure and assumed the other half.** A test killed the database's *idle* connections and the API survived, so I believed a database restart was covered. pg-pool removes its `error` listener from a connection the moment it's checked out, and every transaction checks one out. Lesson: for each failure, ask what state the system is in when it happens, and test the busy state too.
- **A rule I wrote down wasn't the framework's default.** "Never log the error object" was in `secrets.md` and in my own code, but the first unexpected error in a request would have gone through Nest's handler, which logs exactly that. Lesson: a rule about logging has to be enforced at every exit: my code, the framework's handler and the runtime's crash report.
- **My runbook described an AWS that had changed.** It was written in early November for IAM users and a Mumbai default. The account I opened came from the new experience (September 2026): no IAM users for people, and a Region lock. Lesson: before following cloud steps, look at the real account; providers change their onboarding faster than notes age.
- **A cost alarm can be blind.** AWS Budgets subtracts credits by default, so an alert at $5 would never fire on a credit-funded account. Lesson: check what a monitor measures, not only that it exists.
- **My latency guess was half the real number.** ADR 0030 guessed 0.1–0.15 s for Sydney; measured, it's 0.2 s per round trip, which alone breaks the 200 ms scan target. Lesson: measure before it shapes a design; here it changed how the billing screen must look up items.
- **Old credentials were waiting on the laptop.** A working access key for a finished project was the default AWS profile, one forgotten `--profile` away from building in the wrong account. Lesson: before cloud work, check what credentials the tools will pick up, and pin the account in Terraform.
- **CI was red for four pushes and I didn't look.** The db tests needed a build of the shared package that only my laptop had. Lesson: read CI on every push, and when local and CI disagree, look for local state first.
- **Two of my "failing" tests had never failed.** Leftover data or a no-op input made them pass without the fix. Lesson: run each new test against the old code first.
- **My editing tool decoded the escapes I wrote**, so tests held invisible characters a reviewer couldn't see. A scan for format characters found them. Lesson: check the bytes of what you test, not how it looks.
- **My first deploy-script fix didn't work**: `python -I` ignores `PYTHONUTF8`. The review reproduced it. Lesson: test a fix in the same conditions as the bug (piped, not on a terminal).
- **Every one of the four Day 3 PRs had real bugs CI didn't catch.** Green checks and a lane's own tests passed, yet a review found 39 problems, among them a backup restore that would have failed on RDS, a login limit beaten by parallel guesses, and a form that could overwrite another counter's change. Lesson: a fresh-context review before every merge is part of "done", not an extra.
- **A merge between lanes broke the backup.** Login added the `auth` schema; the backup role couldn't read it, so every nightly dump would have failed. The restore test caught it only because it runs the real `pg_dump`. Lesson: a cross-cutting rule (every table is backed up) needs a test that sees new tables automatically.
- **I planned for four lanes and hit the usage limit three times.** Each stop cost a resume, and once an RDS start was left in flight. Lesson: size parallel work to the real budget, and check cloud state after any interruption.
- **A merge with no conflict markers was still broken.** Two lanes each added a `CLOCK` token, and a test from one lane didn't know the other lane's new settings field. Only the type-check and full test run after merging `main` showed it. Lesson: after every merge between lanes, run every check, not just resolve the markers.
- **My lane instructions allowed a force-push, and the permission check refused to start the lane.** The project rule is no force-push without the owner; merging `main` in was always the safe way. Lesson: when a safety rail stops you, change the approach, not the rule.
- **The session started with two tools down:** the AWS sign-in had expired and Docker Desktop wasn't running after a restart. Lesson: check sign-ins and services before cloud or database work, not when the first command fails.
- **A plan step trusted a sentence in my own ADR.** ADR 0027 said backups could run "as the RDS master"; AWS's docs say the master can't bypass RLS. Lesson: re-check a stored claim against the source when a design leans on it.

## Interview questions I can now answer

- Q: Why is your server in Sydney when your users are in India?
  A: My AWS Free plan project is locked to Sydney. Mumbai needs a paid plan and an irreversible "advanced features" switch, and my budget is zero. Measured, it adds about 0.2 s per round trip, so the billing screen looks items up in the browser instead of asking the server per scan; real shop data would need the Region reopened. (ADRs 0030, 0032)
- Q: How do you stop the cloud costing you money?
  A: The Free plan can't charge my card; the risk is burning credits early. A budget that excludes credits alerts at $5, $10 and $15 a month and on forecast, the server and database run only during sessions and demos, and every resource's cost is stated before Terraform creates it. (ADR 0030)

- Q: How does Terraform on your laptop authenticate to AWS?
  A: `aws login` turns my console sign-in into 12-hour credentials that renew for up to 90 days, and the AWS provider reads them natively, so no access keys exist. The provider also pins the allowed account ID, so wrong credentials make it fail instead of building in the wrong account. (ADR 0031)
- Q: What does your setup cost, and what still costs money while it's stopped?
  A: $0.0512 per running hour (server, public IP, database) plus $4.73 a month for the two disks, which bill even while stopped. That's about $8 a month for sessions and demos, $42 around the clock. No Elastic IP, because it bills while stopped too. (ADR 0032)

- Q: What happens to your API when the database restarts in the middle of a request?
  A: That request fails with a 500 and the process keeps running. It used to crash: pg-pool listens for `error` only on idle connections, and Node kills a process on an `error` event with no listener. I listen on every connection the pool opens, and a test terminates the backend mid-transaction to prove it. (`packages/db/src/client.ts`)
- Q: How do you keep customer data out of your logs?
  A: Only messages are logged, never error objects. A failed query's error carries its values and PostgreSQL's `detail` line, and Nest's default handler logs the whole object, so I replaced it with a filter that logs one line and answers a plain 500. The same rule covers startup failures and uncaught errors. (`docs/devops/secrets.md`)
- Q: How do you make an audit log tamper-proof for the app?
  A: The app's role has only INSERT and SELECT, a test proves UPDATE, DELETE and TRUNCATE fail with `42501`, and a guard fails CI if any route back opens up: column grants, views without `security_invoker`, or definer functions the app can call. (ADR 0028)
- Q: Why does the log helper take a transaction instead of the database?
  A: So it can't commit separately: a rolled-back action leaves no log row, and a committed one can't be missing it. (ADRs 0007, 0028)
- Q: Two entries in one transaction have the same timestamp. How do you order them?
  A: `now()` is the transaction's start time. I order by the UUIDv7 id, which increases within a session. (ADR 0028)
- Q: How does a shop owner recover a forgotten password with no phone app?
  A: An emailed reset link once the email is confirmed, plus a recovery key printed at signup. SMS OTP was rejected because it costs money per message and needs DLT registration in India. (Module 00 #30–#33)

- Q: How does your app set the tenant, and what stops it leaking to the next request?
  A: `set_config('app.business_id', $1, true)` inside the transaction. `true` ends it with the transaction; on that connection it then reads as `''`, which my function turns into NULL, so the next request sees nothing until it sets its own business. (ADR 0027)
- Q: How do you create a tenant when the tenants table is itself protected by RLS?
  A: Generate the new ID first, set it as the current business, then insert. The row passes its own policy; no bypass role exists to protect. (ADR 0027)
- Q: How do you know every future table has RLS?
  A: A test reads the catalogue and fails CI on any table without RLS, `FORCE`, the one correct policy, `business_id`, the right grants or business-scoped foreign keys. Each rule is proven by a probe table that breaks it. (ADR 0027)
- Q: Can RLS alone stop a row pointing at another tenant's data?
  A: No: foreign-key checks skip RLS. Keys between tenant tables are composite, `(business_id, branch_id) → branches(business_id, id)`. (ADR 0027)
- Q: What does `FORCE ROW LEVEL SECURITY` change, and what does it break?
  A: Table owners skip RLS without it. With it, the owner is filtered too, so data migrations must lift it inside their transaction, and backups need a `BYPASSRLS` role, or `pg_dump` fails or comes out empty. (ADR 0027)

- Q: How does your demo server get a new version?
  A: A script sends a Systems Manager Run Command naming one commit. The server downloads the repo at that commit, installs its files and pulls the images built from it, so what runs is one hash. No SSH, no open port. (ADR 0034)
- Q: How do you keep one email from becoming two owner accounts?
  A: A partial unique index on owner emails, which sees every tenant's rows despite RLS, plus a CHECK that emails are lower-case printable ASCII, so zero-width spaces and look-alike letters can't make a second spelling. (Module 00 #27)
- Q: Why Argon2id from Node itself?
  A: Node 24 ships it in `crypto`, so there's no native npm package to build for ARM64. OWASP's parameters (19 MiB, 2 passes) cost about 30 ms per hash, and the PHC string stores them with the hash so they can change later. (ADR 0035)

- Q: How do you back up a database where row-level security hides rows even from the owner?
  A: A dedicated read-only role with its own policy on every tenant table. A CI guard fails if any table lacks it or the role gains a write right, and the dump script refuses to run if the live database is missing one, because a backup with empty tables looks fine until you need it. (ADR 0037)
- Q: How do you stop a compromised server from destroying its own backups?
  A: It can only add files: the bucket policy denies any upload without `If-None-Match: *`, so an existing backup can't be overwritten, and the server has no read, list or delete rights. (ADR 0037)
- Q: How do you limit password guesses when hashing is slow?
  A: Count the attempt before the slow Argon2 check, not after, or many guesses sent at once all pass the check before any is counted. A right password takes the count back. (ADR 0038)
- Q: How do two counters editing the same item not overwrite each other?
  A: Each item has a version; a save sends the version it loaded, and the server answers `409 stale` if it changed. The form must keep the version it loaded, not the latest one from the cache. (P1.7)

- Q: How does a merge get to your server, and how do you stop a bad one?
  A: The deploy job needs my approval in a GitHub environment that only `main` can use; AWS trusts GitHub's OIDC token only for that environment, so no key is stored. It backs up first, deploys one commit, checks health and rolls back. A repository variable stops every run unless it says `off`. (ADR 0012 note, stage 6)
- Q: Why limit recovery-key tries by IP and not by account?
  A: A per-account limit lets anyone who knows the owner's email lock them out of recovery for an hour: a denial of service. The key is 160 random bits, so guessing is hopeless anyway; a per-IP limit stops brute force without that side effect. (`00` #41)
- Q: How do you keep stock right when two counters sell the same item?
  A: Every change goes through one function that locks the item's stock row (`SELECT … FOR UPDATE`, in item-ID order to avoid deadlocks), checks the rule, writes an append-only movement and updates the balance in one transaction. A 3 s lock timeout answers `503` instead of hanging a connection. (ADR 0041)
