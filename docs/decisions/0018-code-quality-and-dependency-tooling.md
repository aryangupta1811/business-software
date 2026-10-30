# 0018 — Code quality and dependency tooling: ESLint + Prettier, pnpm catalogs, supply-chain guards

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

P0.2 set up the monorepo (ADR 0002). Each package needs the same checks, and `CLAUDE.md` rule 8 asks for no bugs and no unnecessary code. The repo is public and depends on hundreds of npm packages written by other people, and hijacked npm releases are a real, recurring attack. Versions installed in late October 2026: TypeScript 7.0 (the new compiler rewritten in Go) was the latest, but typescript-eslint 8.72 only supports TypeScript `>=4.8.4 <6.1.0`.

## Options considered

### Option A — ESLint with typescript-eslint's type-aware rules, plus Prettier
- Pros: type-aware rules use the compiler's type information to catch real bugs a syntax check can't see, like a promise that is never awaited (a silently unsaved bill) or a value that may be `undefined`; the standard tools, so most interviewers know them; plugins exist for React, accessibility and imports when the apps arrive.
- Cons: two tools and more config; type-aware linting is slower; ESLint follows the TypeScript version that typescript-eslint supports, which can lag behind new releases.

### Option B — Biome (one tool for linting and formatting)
- Pros: very fast, one config file, formatting and linting in one pass.
- Cons: its type-aware checks are still far narrower than typescript-eslint's `strictTypeChecked` set; fewer plugins for the React and accessibility rules we'll need.

### Option C — TypeScript's own checks plus Prettier, no linter
- Pros: least setup.
- Cons: the compiler doesn't flag unawaited promises, `any` creeping in, or unnecessary conditions.

For dependency versions:

### Option D — each package lists its own versions
- Pros: no extra concept.
- Cons: the web app, API and shared code can drift onto different TypeScript or Vitest versions and behave differently.

### Option E — pnpm catalog
- Pros: one list of versions in `pnpm-workspace.yaml`; packages write `"catalog:"`, so a tool is upgraded once for the whole repo.
- Cons: one more pnpm feature to learn.

## Decision

- **Linting:** ESLint (flat config at the root) with typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`, made type-aware with `projectService`; `eslint-config-prettier` turns off the formatting rules. Plain JavaScript config files skip the type-aware rules.
- **Formatting:** Prettier for code and config (`singleQuote`, `printWidth: 100`); Markdown docs are not reformatted.
- **Versions:** tools used by more than one package go in the pnpm catalog. TypeScript is pinned to `~6.0` (patch updates only) until typescript-eslint supports TypeScript 7.
- **Supply chain:** the lockfile is committed; pnpm's `minimumReleaseAge` is 1 day (only versions public for a day are installed); dependencies' install scripts stay blocked unless one is approved with a reason.
- `pnpm check` runs formatting, lint, type-check and tests, the same order CI will run (P0.6).

## Why

- Type-aware rules catch the bug classes that matter for zero data loss, such as an unawaited database write. That is worth slower lint runs and a second tool.
- A catalog keeps every package on the same tool versions, so a test that passes in `shared` passes for the same reason in the API.
- Poisoned npm releases are usually found and pulled within hours, so a one-day wait avoids most of them. Install scripts are the usual way such code runs, so they stay blocked. Both cost almost nothing.
- Each check was proven by planting an error that it must catch (interview log, 2026-10-30).

## Consequences

- **Upgrade TypeScript to 7 when typescript-eslint supports it:** change the catalog line, then run `pnpm check`. Until then we miss TypeScript 7's faster type-checks.
- A security fix released less than a day ago needs an explicit install.
- New `.ts` files must be inside some package's tsconfig `include`, or type-aware lint can't find them (e.g. a future `vite.config.ts`).
- New packages (`apps/web` in P0.5, `apps/api` in P0.4) reuse the root ESLint/Prettier config and add their own plugins (React, accessibility).

## Interview note

I use ESLint with type-aware rules, not just a formatter, because rules like "no floating promises" catch an unawaited database write, the kind of bug that loses a bill. I tested each check by planting an error it had to catch. Dependencies are code I didn't write, so the lockfile pins them, install scripts are blocked by default, new versions wait a day before I take them, and one catalog keeps every package on the same versions.
