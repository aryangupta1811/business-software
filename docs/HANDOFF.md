# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 16 — DevOps stage 4 steps written, 2026-11-02

**Done:**
- Module 00's PR was already merged as **#11**; its branch is gone.
- Owner: placement season is close, so **DevOps stage 4** comes before P1.3 (the owner wrote "closed"; read as "close" and not corrected — confirm at the next session).
- Read AWS's *Choosing a plan* page and the Free Tier FAQ (2026-11-02): **joining AWS Organizations upgrades a Free plan account to Paid** (irreversible), and the Free plan and credits are **only for new AWS customers**. The owner floated a second account in a family member's name; Claude advised against it (that rule; the account and bill would legally be hers). A family member's card as the payment method on the owner's own account is fine.
- **ADR 0029** (new): root locked away with MFA; daily work as an IAM user with MFA in group `admins` (`AdministratorAccess`, narrowed at stage 10); **no Identity Center / Organizations / Control Tower** on the Free plan; CLI credentials for stage 5 still to decide (short-lived).
- **Runbook** `docs/devops/aws-account.md`: steps A–F, the irreversible rules, what not to do yet. Row added to `CLAUDE.md`'s file table.
- PROGRESS stage 4 line rewritten; interview log (1 entry, 2 questions, 5 glossary terms, ADR count 29).

**Half-done:**
- The PR for branch `docs/devops-stage-4` (1 commit, not pushed, not merged).
- **Stage 4 itself:** the owner does the runbook's steps A–E on their own, later. Nothing has been created in AWS yet.

**Next step:**
1. Owner: `git push -u origin HEAD`, `gh pr create --web` with title `docs: add aws account runbook and adr 0029`, fill in the template, **Squash and merge** when the five checks are green. Then `git switch main`, `git pull`, `git branch -D docs/devops-stage-4`.
2. Owner: open the AWS account with `docs/devops/aws-account.md`, steps A–E.
3. Next session: `/start-session`, then check stage 4 together (step F: plan shown is Free, credit balance, days left, the Explore AWS activity list), plan the credit activities that launch a server or database so nothing is left running, and tick stage 4. Then **P1.3 Signup & business setup**, design first (brainstorm → spec → plan, owner approves section by section).

**Watch out for:**
- **AWS (ADR 0029, runbook):**
  - Never join or create an AWS Organization, set up Control Tower, or turn on Identity Center's organization instance while on the Free plan: it upgrades to Paid, irreversibly.
  - One account only, in the owner's own name.
  - The 6-month clock started at sign-up (date it in PROGRESS once the owner reports it). Credit activities must be done within 6 months; earned credits expire 12 months after sign-up.
  - Before creating anything, state its expected cost against the remaining credits (ADR 0011). RDS restarts itself after 7 days stopped.
  - Never commit the account ID, sign-in alias or link, root email or passwords.
  - The 2026-10-29 interview log entry (`aws sso login`) describes the old plan; stage 5 decides the laptop's short-lived CLI credentials (check what the installed AWS CLI v2 offers; no long-lived access keys if avoidable).
- **No AI attribution, ever:** no `Co-Authored-By: Claude` and no "Generated with Claude Code" (`CLAUDE.md` rule 6 overrides tool defaults).
- **Module 00 rules that shape P1.3/P1.4:**
  - Owner email is unique **across all businesses** (#27): a global unique index, outside RLS's per-business view. The login lookup is the narrow cross-business path (ADR 0027), a `SECURITY DEFINER` function on `DEFINER_ALLOWED`.
  - Staff usernames are unique **within a business**: `unique (business_id, username)` (also the P1.7 rule that every tenant unique key includes `business_id`).
  - The recovery key and reset tokens are random bytes stored only as hashes; never UUIDv7 (ADR 0027).
  - Sending email is new infrastructure: P1.4 needs an ADR (e.g. SES in the cloud, Mailpit locally). SES needs a verified domain (stage 5) and leaving its sandbox. The secret rules in `docs/devops/secrets.md` apply.
  - Auto-lock (owner, 5 min) and staff idle logout (30 min) are per-business settings.
- **Entry log rules (ADR 0028):**
  - Write only through `recordEntry(tx, …)` inside the action's own `withBusiness` transaction; never `tx.insert(entryLog)` (the table is still exported; P2.6 should stop that).
  - A new action goes into `ENTRY_ACTIONS` with `reasonRequired`.
  - `actorId` is the logged-in person, or `null` only for the system.
  - Order entries by `id`, not `created_at` (entries in one transaction share `now()`).
  - Fix a wrong entry by recording a correcting one; `app_runtime` can't UPDATE or DELETE it.
- **Guard rules (`src/tenancy-guard.test.ts`):** every view needs `with (security_invoker = true)`; no column-level UPDATE on an `APPEND_ONLY` table; a `SECURITY DEFINER` function the app can run must be on `DEFINER_ALLOWED` with its reason (P1.4's login lookup: also revoke PUBLIC and pin `search_path`); exactly one `app_current_business_id()`; `app_runtime` belongs to no role; a new non-tenant schema goes on `NOT_TENANT_SCHEMAS` with its reason.
- **Test helper:** `startTestDatabase().adminUrl` is the superuser on the app database (`business_software`); use it for roles and schemas, which `app_owner` can't create.
- **Tenancy rules (ADR 0027):**
  - A new tenant table uses `id()`, `businessId()`, `createdAt()` and `tenantPolicy(t.businessId)`, and its migration adds `ALTER TABLE … FORCE ROW LEVEL SECURITY` by hand.
  - Keys into another tenant table are composite: `(business_id, x_id) → x(business_id, id)`, and `x` needs `unique (business_id, id)`.
  - Only one permissive policy (`tenant_isolation`); no materialized views or foreign tables for tenant data.
  - Code reaches tenant data only through `withBusiness(db, id, work)` / `withNewBusiness`; never pass a transaction.
  - A data migration as `app_owner` changes 0 rows unless it lifts `FORCE` inside its transaction; test the row count.
  - `pg_dump` as `app_owner` fails; never use `--enable-row-security` (empty tables). Backups need a `BYPASSRLS` role (stage 7).
  - Drizzle wraps driver errors: the PostgreSQL code is on `error.cause.code` (a raw `pg` Pool: `error.code`). RLS `WITH CHECK` runs before NOT NULL, so a missing business gives `42501`.
- **Design rules (web):**
  - Only tokens exist: `bg-surface`, `text-muted`, `text-body`; no `stone-*`, no `text-sm`. Text sizes are `text-label/body/section/title/figure`.
  - Tailwind needs whole class names in the source: never `` `bg-${x}` ``.
  - A new colour pair used for text must be added to the RULES in `src/theme/contrast.test.ts`.
  - Code that reads colours at runtime must accept short hex (`#fff`).
  - Modals use the native `<dialog>`, not Radix Dialog (CSP). Radix Tooltip is fine.
  - Shortcuts go through `useShortcut`; plain letters and the browser's keys are refused (ADR 0026).
- **CSP:** `script-src 'self'; style-src 'self'`. No inline scripts or styles. Check new libraries in the real build with the console open.
- **Every new string goes in all three locale files.** Hindi values must contain Devanagari; Hinglish none.
- **Review minors** are filed in PROGRESS under P1.3, P1.4, P1.7, P1.13, P2.6 and stage 7.
- **CI is the gate.** All five checks are required, and a PR must be up to date with `main`.
  - PR titles: lowercase Conventional Commit, at most 72 characters, no full stop.
  - GitHub's *Revert* button title fails: rename it to e.g. `fix: revert …`.
- **Migrations:** never edit, re-date or delete one that's on `main`. Add a new one instead.
- **A red `secrets` check fails every PR.** Revoke a real key first; for a false positive, add its fingerprint to `.gitleaksignore` in a PR; never commit a fake secret to a real branch.
- **gitleaks isn't installed locally:** run it with the Docker command in `docs/devops/git-workflow.md` (PowerShell, Docker Desktop running).
- **Pinned versions:** Dependabot updates only `uses:` actions; the gitleaks and actionlint images are bumped by hand. New actions are pinned to a SHA with a `# vX.Y.Z` comment; `${{ github.event.* }}` values go through `env:`.
- **Shell gotchas:** never write repo files with PowerShell `Set-Content`/`Add-Content`/`Out-File` (BOM and CRLF). In Git Bash, no bare `cat > file` before a heredoc, and long Python with quotes goes in a scratchpad script file.
- **Git:** after a squash merge, `git branch -d` refuses (git can't see the commits in `main`); use `-D`. `git switch -c` only creates; to move onto an existing branch use `git switch <name>`.
- **Browser checks:** the Chrome window's size doesn't change the page width on this laptop (display scaling); constrain `<html>` width in JavaScript to test narrow layouts.
- **Deferred minors (older):**
  - From P0.6: the "reproduce `check`" row in `git-workflow.md` lacks the actionlint command; the repo setting *Require actions to be pinned to a full-length commit SHA* is off (owner decides).
  - From P0.5: an asset URL with a trailing slash gets a 308 with the immutable header; a Caddyfile edit reruns the Vite build; no fake-timer test of a hanging fetch; polling pauses in background tabs.
  - From P0.4: `describeError` gaps (an empty `AggregateError`, a cyclic `cause`, `cause: null`); no query timeout on `/ready`; Node 25+ drops Corepack (note it in ADR 0020 before `node:26-slim`).
- **Carried over:**
  - Docker Desktop must be running for `pnpm test`, `pnpm check`, `db:up` and `app:up`.
  - Never `docker compose down -v` without OK. The bootstrap runs only on an empty volume.
  - pnpm 12 `ERR_PNPM_IGNORED_BUILDS`: decide each package with a reason. A pre-existing peer warning (`eslint-plugin-jsx-a11y` wants ESLint ≤ 9) is known.
  - TypeScript stays pinned to `~6.0`. New `.ts`/`.tsx` files must be in a tsconfig `include`. `exactOptionalPropertyTypes` is on: leave an optional property out instead of setting it to `undefined`.
  - `packages/shared` has no Node/DOM globals; `apps/web` has no Node types (tests read files with Vite `?raw`).
  - Test data must not look like personal data.
  - `refs/original/` still holds the pre-rewrite commits (ask before deleting).
  - Answer the Module 01 open questions before P1.7.
