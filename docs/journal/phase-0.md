# Phase 0 — Foundations

In progress. The detailed diary is `INTERVIEW_LOG.md`.

## What we built

- **2026-10-29 (planning chat):** requirements for all modules, with Modules 00 and 01 decided, stored as files in git.
- **2026-10-29 (kickoff session):** confirmed non-functional requirements with measurable targets (RPO 5 min, RTO 1 hour, bill save < 1 s); answered the six architecture questions; chose the stack (16 ADRs); wrote `docs/architecture.md`; split Phases 0–3 into one-session tasks; started the interview log.
- **2026-10-30 (P0.1 Git workflow, DevOps stage 1):** scanned all git history for secrets (gitleaks in Docker) and personal data, then made the repo public; protected `main` with a ruleset nobody can bypass; squash merge only; Conventional Commits; PR template; LF line endings via `.gitattributes`; secret scanning, push protection and Dependabot alerts; commits use the GitHub noreply email. Every setting checked through the GitHub API.
- **2026-10-30 (P0.2 monorepo scaffold):** pnpm workspace with strict TypeScript, ESLint (type-aware) + Prettier, Vitest; `pnpm check` runs everything. First shared code: `parseRupees` and `formatPaise`, written test-first (45 tests, floating-point traps included). Each check proven to fail on a planted error; a fresh reviewer then tried about 60 hostile inputs and found no wrong amount.
- **2026-10-30 (P0.3 database + Docker Compose, DevOps stage 2):** PostgreSQL 18 in Docker Compose (localhost-only port, named volume proven to survive `compose down`, required-password guards). Two roles from a bootstrap file: `app_owner` for migrations, `app_runtime` for the app. The first Drizzle migration sets default privileges, so every future table gives the app select/insert/update and never delete. 9 integration tests on a throwaway PostgreSQL (Testcontainers) prove delete, truncate, create, drop and reading migration history are refused, and pin the exact grant set. Planted `DELETE`, `TRIGGER` and missing-sequence grants are each caught. A fresh reviewer verified all five review-focus risks on the live database. It found no bugs, but did find two wrong facts in my notes and a test gap, all fixed.
- **2026-10-30 (P0.4 API skeleton, DevOps stage 2 second half):** NestJS 12 API with liveness (`/api/health`) and readiness (`/api/health/ready`), a worker and a one-shot migrate entry point, all from one non-root `node:24-slim` image. Compose starts db → migrate (as `app_owner`) → api and worker (as `app_runtime`). Packages compile with TypeScript project references, and a `source` export condition lets tests and lint skip the build. Secrets rules for the whole project (`docs/devops/secrets.md`), at the owner's request about the AI key. Docker smoke tests found two real bugs: the worker exited after pg's 10 s idle timeout, and the API exited 143 instead of 0. Both were fixed, but only the worker fix has an automated test: exit codes on SIGTERM can't be tested on Windows, so they're checked by hand until a Linux CI smoke job (P0.6). The final review found the entry points skipped the messages-only logging on a crash, and the worker crash-looped when the database was down at startup; both fixed test-first. Logs now never include error objects or query values. The API listens on `127.0.0.1` unless `HOST` says otherwise. 84 tests. ADRs 0020–0022.
- **2026-10-30 (P0.5 web skeleton):** React 19 + Vite 8 app in `apps/web` with TanStack Router (file-based) and Query, Tailwind 4 (setup only), and a header with a server connection badge and an English/Hindi/Hinglish switch. The owner added Hinglish (`hi-Latn`) at the start of the session. Locally Vite proxies `/api`; in Compose a Caddy container (non-root) serves the files and proxies `/api`, as on the server. Hashed assets are cached for a year and `index.html` never, deep links fall back to `index.html`, missing assets are a real 404, and a strict CSP is on every response. No `VITE_` variables. Checked in headless Chrome over the DevTools protocol: no CSP violations, all three languages, and the badge reacts to the database or API being stopped. 36 web tests (121 in all). ADR 0023.
- **2026-10-31 (P0.6 CI):** GitHub Actions with five required checks on every PR: `check` (format, lint, types, 130 tests including Testcontainers, build, actionlint), `secrets` (gitleaks, whole history), `migrations` (a new migration must be newer than `main`'s, ADR 0021's trap, and `main`'s migrations can't be removed, re-dated or edited), `smoke` (both images built with the GitHub layer cache, started with Compose, then readiness, Caddy headers, a failing migration and clean stops) and `pr-title`. Actions pinned to SHAs and kept fresh by Dependabot (the gitleaks and actionlint images are bumped by hand), read-only token, no secrets. Each check was made to fail once on purpose. All green on the first run; a full run takes about 3 minutes. README with the CI badge. ADR 0024.
- **2026-10-31 (P0.7 design system):** the owner chose the look from browser mockups: Apple-clean (cool white, one blue accent), 8 px corners, IBM Plex Sans with Plex Devanagari, light by default with a sun/moon button. Tokens are CSS variables mapped into Tailwind with the default palette removed, and a WCAG contrast test runs over both modes; it rejected two colours from the approved table. Fonts self-hosted, a tiny external script prevents a dark-mode flash (the CSP blocks inline scripts), base components copied from shadcn/ui, a sidebar and top-bar layout, a keyboard-shortcut registry built for a barcode scanner (`?` help in a native `<dialog>`, `Alt+H` Home), a favicon and a `/design` showcase page. Checked in Chrome through Caddy: no CSP violations, all six mode/language combinations, no overflow at 1024 px. 217 tests (123 web). ADRs 0025–0026.

## Stack choices vs alternatives

| Area | Chose | Over | ADR |
| --- | --- | --- | --- |
| Offline | Online-first, offline-ready IDs | Offline sync | 0001 |
| Language | TypeScript everywhere (pnpm monorepo) | Python FastAPI, Java Spring Boot | 0002 |
| Frontend | React + Vite SPA | Next.js, Angular/Vue | 0003 |
| Backend | NestJS modular monolith | Minimal framework, microservices | 0004 |
| Database | PostgreSQL + Drizzle | MySQL, MongoDB; Prisma | 0005 |
| Multi-tenancy | Shared tables + Row-Level Security | Database or schema per business | 0006 |
| Data safety | Enforced in the database | App code only | 0007 |
| Money | Integer paise | Floats, decimal type | 0008 |
| Login | Server sessions + Argon2id | JWT, hosted auth | 0009 |
| Jobs & WhatsApp | pg-boss + outbox + Cloud API test number | Redis/BullMQ, SQS; mock, Twilio | 0010 |
| Hosting | AWS Free plan: one EC2 + RDS, Terraform | ECS + load balancer, single VPS only, PaaS, EKS | 0011 |
| CI/CD | GitHub Actions + OIDC + Systems Manager | Jenkins, CodePipeline | 0012 |
| Testing | Vitest + Testcontainers + Playwright | Mocks / SQLite | 0013 |
| Printing | Browser print CSS + kiosk printing + Chromium PDFs | Local print agent, desktop app; JS PDF libraries | 0014 |
| AI | Claude API through permission-checked tools | Text-to-SQL, reports only | 0015 |
| Demo data | Deterministic seed through services | SQL inserts, random inserts | 0016 |
| Git workflow | GitHub flow, squash merge, Conventional Commits, public repo with a ruleset | Git Flow, direct commits to `main`; merge or rebase merges; private repo until the Student Pack | 0017 |
| Code quality & dependencies | ESLint (type-aware) + Prettier, pnpm catalog, lockfile + blocked install scripts + 1-day release age | Biome, no linter; per-package versions | 0018 |
| Database roles & local DB | Bootstrap file + default privileges; `pg`; Drizzle 0.45; Debian `postgres:18` in Compose | Roles in migrations or Terraform; per-table grants; postgres.js; Drizzle 1.0-rc; Alpine | 0019 |
| API build & runtime | `tsc -b` project references + `source` export condition; Express; Nest JSON logger; multi-stage `node:24-slim` | Bundling, Node type stripping; Fastify; pino; Alpine, distroless | 0020 |
| Production migrations | One-shot `migrate` container as the owner role, before the app | Migrate at app startup, from CI, by hand | 0021 |
| Job-queue role | `app_queue` owning only schema `pgboss` | Owner-installed pg-boss + scoped DELETE; CREATE for the runtime role | 0022 |
| CI pipeline | GitHub Actions, Testcontainers in CI, bash PR-title check, gitleaks Docker image, `build-push-action` with the `gha` cache, SHA-pinned actions | `services:` database, marketplace title action, `gitleaks-action`, `compose --build`, version tags | 0024 |
| Web build & serving | Caddy container serving the build, hashed-file caching, strict CSP, file-based routes, i18next with `en`/`hi`/`hi-Latn` | nginx, `vite preview`; code-based routes; happy-dom | 0023 |
| Design system | Apple-clean CSS-variable tokens + contrast test, IBM Plex self-hosted, light default, shadcn copied by hand | Warm-paper or slate looks; Inter, Mukta; follow the OS theme; shadcn CLI | 0025 |
| Shortcuts & modals | Own registry (physical keys, scanner-safe in fields); native `<dialog>` | react-hotkeys-hook, tinykeys; Radix Dialog (+ `'unsafe-inline'` styles) | 0026 |

## Mistakes and what I learned

- **Assumed a budget I didn't have.** The first hosting plan assumed ₹1,000/month. With ₹0 and the AWS Free plan ($200 credits, 6 months, account closes after), it would have run out in about 4 months. Redesigned around one EC2 server + RDS, keeping point-in-time restore. Lesson: pin down the real constraint before designing.
- **App and API on different domains would have broken login.** Session cookies aren't sent cross-site. Fixed by serving both from one domain through Caddy. Lesson: auth choices shape hosting.
- **A Claude subscription is not an API key.** The app needs a separate, pay-as-you-go Claude Console key.
- **The repo started inside OneDrive,** which can corrupt `.git`. Moved it out in P0.0.
- **Assumed settings were done; the API said otherwise.** After the GitHub settings, reading them through the API showed secret scanning was still off. Lesson: verify configuration from the source of truth, not from memory or a screenshot.
- **A check that never fails proves nothing.** The first personal-data search found nothing because its pattern got mangled on the way to `git grep`; only testing it against a known example exposed that. Lesson: make a check catch something before trusting it.
- **Installed "latest" TypeScript and broke the linter's peer range.** TypeScript 7 isn't supported by typescript-eslint yet; pinned `~6.0`. Lesson: read peer-dependency warnings.
- **My plan claimed Node could run `shared` from source. It can't.** The tests passed only because Vite resolves `./money.js` to `money.ts`. A fresh reviewer caught it; P0.4 now plans a compile step. Lesson: "works in the test runner" isn't "works in production".
- **Tutorial config was stale, and so was my explanation of it.** The Postgres 18 image moved its data folder, so I mounted the new path. I then wrote that the old path would silently lose data. The final review showed the image refuses to start with the old mount instead. Lesson: verify the explanation as well as the config.
- **Checked the worker for 3 seconds; it died at 10.** Waiting on a signal doesn't keep Node alive, so the worker exited when pg closed its idle connection after 10 s. Only the Docker run (with a restart counter) showed it. Lesson: observe longer than the slowest timer in the system.
- **Wrote down a security "fact" too broadly.** I saw a password in a test's error report and wrote that pg errors always carry it. pg hides it, and only some serializers print it. The rule (log only messages) was right, the explanation wasn't. Lesson: verify the claim, not just the fix.
- **Broke Vitest with an invisible character.** A PowerShell edit wrote a BOM into `package.json`, and Vitest's error blamed a missing `jsdom`. The real error was higher up in the output. Lesson: read the first error, not the last, and edit files with tools that don't add a BOM.
- **Trusted the config instead of the response.** The Caddyfile looked right, but `curl -I` showed a 404 telling browsers to cache it for a year, without the security headers. Lesson: check the real response, error cases included.
- **Two 5-second timeouts raced, and my one-off check passed by luck.** The browser and the API's database wait both gave up at 5 s, so "database down" showed as "server down" on about 2 of 5 loads. I had checked it once; the reviewer checked it five times. Lesson: an outer timeout must be clearly longer than the inner one, and anything that can race must be checked more than once.
- **My own PR title broke my own rule.** Back-testing the new PR-title check on `main`'s history showed P0.5's title was 73 characters, over the 72 in my git-workflow doc. Lesson: a rule nobody checks drifts; back-test a new check on real data.
- **Assumed the CI cache would help everywhere.** On a new branch it found nothing (GitHub scopes caches by branch) and exporting it took 73 s to save a 6 s install. A warm re-run took 50 s instead of 2 min 47 s. Lesson: measure an optimisation in the cases that actually happen.
- **The owner's approved colours failed my own readability rule.** Blue links on the grey page were 4.31:1 and green on its badge 4.48:1 (WCAG AA needs 4.5). Only the automated test caught it; by eye both looked fine. Lesson: turn a goal like "easy to read" into a number a test can check.
- **The production build changed my data.** The CSS minifier writes `#ffffff` as `#fff`, so `/design` showed NaN for every contrast ratio. Unit tests read the source CSS, so only the real build in a real browser showed it. Lesson: test the artefact you ship, not just the source.
- **Waited for a GitHub login code on my phone.** The device-flow code is printed in the terminal. Lesson: read the tool's output before looking elsewhere.

## Interview questions I can now answer

- Q: Why a modular monolith and not microservices?
  A: A bill must update billing, stock and udhaar in one transaction. A monolith does that with one `BEGIN…COMMIT`; microservices would need sagas. (ADR 0004)
- Q: How do you keep tenants' data apart?
  A: `business_id` on every row plus PostgreSQL Row-Level Security, with the app connected as a role that can't bypass it, and tests that try cross-tenant reads. (ADR 0006)
- Q: How do you guarantee zero data loss?
  A: No `DELETE` permission for the app's database user, an append-only log, one transaction per action, idempotency keys, RDS point-in-time restore (RPO 5 min) and a monthly restore drill. (ADRs 0007, 0011)
- Q: How did you host it with no budget?
  A: AWS Free plan credits, with a design sized to them: one EC2 server running Docker Compose plus RDS, and no load balancer or NAT gateway. It's all Terraform, so scaling up is an infrastructure change. (ADR 0011)
- Q: How does your pipeline deploy without AWS keys?
  A: OIDC gives each GitHub Actions run short-lived credentials, and Systems Manager runs the deploy on the server, so there's no SSH port. (ADR 0012)
- Q: What's your branching strategy?
  A: GitHub flow: a short-lived branch per task, merged into a protected `main` by pull request, squash-merged as one Conventional Commit. Nobody can push to `main` directly, me included. (ADR 0017)
- Q: How do you avoid floating-point errors with money input?
  A: Never multiply the decimal (`0.29 * 100` is `28.999…`): split the text at the dot, do integer maths, and refuse anything ambiguous. (ADR 0008)
- Q: How do you protect against malicious npm packages?
  A: A committed lockfile, install scripts blocked by default, a one-day wait on new releases, Dependabot alerts. (ADR 0018)
- Q: How do you keep secrets and personal data out of a public repo?
  A: `.gitignore` and environment variables; a gitleaks scan plus a personal-data search before each commit; GitHub push protection at push time; gitleaks in CI. I scanned the full history before going public. If a secret leaks, revoke it first. (ADR 0017)

**DevOps stage 2 (containers), first half:**

- Q: Image vs container vs volume?
  A: An image is the read-only recipe, a container is a disposable running copy, and a volume holds data outside the container so it survives. `compose down` keeps volumes; `down -v` deletes them. (ADR 0019)
- Q: How does your app avoid starting before the database is ready?
  A: A healthcheck plus `docker compose up --wait`. The healthcheck uses TCP, because during first-start init the image's temporary server only listens on a socket and would look ready too early.
- Q: How is your local database secured?
  A: Port bound to `127.0.0.1`, passwords only in a git-ignored `.env`, Compose refuses to start without them, and the app's role can't delete or change the schema.
- Q: How do your tests get a database?
  A: Testcontainers starts a throwaway PostgreSQL with the same image as `compose.yaml` (the test reads it from there), runs the same bootstrap and migrations, then tests real permissions. (ADR 0013)

**DevOps stage 2 (containers), second half:**

- Q: Why is your app image multi-stage?
  A: The build stage has pnpm and the TypeScript compiler. The final stage copies only the compiled app and its production dependencies, and runs as a non-root user. Smaller, and less to attack. (ADR 0020)
- Q: How do you run migrations when deploying?
  A: A one-shot container from the same image, as the schema-owner role. The app containers depend on it completing successfully, so a failed migration stops the rollout. (ADR 0021)
- Q: Liveness vs readiness?
  A: Liveness means "restart me if this fails". Readiness means "send me traffic only if this passes". My readiness check includes the database, and my liveness check doesn't, so a database outage doesn't cause restart loops.
- Q: What happens on `docker stop`?
  A: SIGTERM, then SIGKILL after 10 s. My processes catch SIGTERM, finish open work, close the database pool and exit 0 in under a second. `init: true` makes sure the signal reaches Node.
- Q: How do you keep secrets out of images?
  A: `.dockerignore` excludes `.env*`, no secret in `ARG`/`ENV`, and values arrive at container start. I checked with `docker history` and the image's environment. (`docs/devops/secrets.md`)

**Web app (P0.5):**

- Q: How does your frontend talk to the backend without CORS?
  A: Same origin. In development Vite's dev server proxies `/api` to the API; in Compose and on the server Caddy serves the built files and reverse-proxies `/api`. The browser only ever calls relative `/api` URLs, so it needs no configuration and can't leak a secret through a `VITE_` variable. (ADR 0023)
- Q: How do you make sure users get a new deploy, but still cache well?
  A: Vite puts a content hash in every asset's name, so `/assets/*` is cached for a year as `immutable`. `index.html` is `no-cache`, so the browser picks up new asset names on the next load. Missing assets are a 404 with `no-store`, never `index.html`.
- Q: What does your Content-Security-Policy do?
  A: `default-src 'self'` and no inline scripts: the browser refuses any script, style or connection that isn't from our own origin, so an injected script can't run or send data out. I checked in a real browser that the built app causes no violations.
- Q: How do you support several languages?
  A: i18next with one JSON file per language (`en`, `hi`, `hi-Latn` for Hinglish). Keys are type-checked against English, and tests compare the files' keys and check each one's script. I found that i18next would fall back from Hinglish to Devanagari Hindi and pinned it with `load: 'currentOnly'`.

**Design system (P0.7):**

- Q: How did you make the UI easy to read, and how do you keep it that way?
  A: Readability was the owner's top priority, so I made it a test: it reads the colour tokens and checks WCAG contrast for every text and edge colour in light and dark. It failed two colours from the approved palette on its first run. (ADR 0025)
- Q: How do you avoid a white flash for dark-mode users?
  A: A tiny script in `<head>` reads the saved theme and sets the `dark` class before anything is drawn. It's a separate file, because my CSP blocks inline scripts.
- Q: How do keyboard shortcuts work with a barcode scanner?
  A: The scanner types into the focused field, so inside fields only F-keys, Esc and Ctrl/Alt combos fire. Letters match the physical key (`event.code`), so Alt+H still works on a Hindi keyboard layout. Held keys, IME composition and AltGr never trigger anything. (ADR 0026)
- Q: Why not use the component library's dialog?
  A: Radix Dialog adds a `<style>` tag at runtime, which my CSP blocks. The browser's `<dialog>` already handles focus, Escape and the backdrop. (ADR 0026)

**CI (P0.6):**

- Q: What runs on every pull request?
  A: Five required checks: lint, types, tests against a real PostgreSQL and the build; a gitleaks scan; a migration-order check; the PR title; and a smoke test of the real images started with Compose. GitHub won't merge until all five pass on a branch that's up to date with `main`. (ADR 0024)
- Q: How do you keep CI itself from being an attack path?
  A: Actions pinned to commit SHAs, a read-only token, no secrets, no `pull_request_target`, and user-typed values like the PR title passed through `env:` so they can't become shell code.
- Q: How did you know the checks work?
  A: I made each one fail on purpose (bad formatting, a fake key, a wrong header, a bad title) and watched it go red with a useful message, on a throwaway branch so the fake key never entered the real history.
