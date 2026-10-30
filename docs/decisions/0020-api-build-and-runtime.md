# 0020 — API build and runtime: project references, Express, built-in JSON logs, one slim image

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

P0.4 creates the NestJS API (ADR 0004). Since P0.2 we knew Node can't run our workspace packages from their TypeScript sources: `packages/shared` imports `./money.js`, but only `money.ts` exists (`ERR_MODULE_NOT_FOUND`). The API must also be compiled, because NestJS's dependency injection reads constructor types from decorator metadata, which only a compiler emits. Facts checked on 2026-10-30: NestJS 12 (August 2026) is ESM-only (`"type": "module"`), which matches our repo. Node 24 strips TypeScript types by default, but refuses to do it for files inside `node_modules`.

The same task also had to choose an HTTP adapter, a logger, how to create the app, and the container image.

## Options considered

### Running workspace packages

#### Option A — Compile each package to `dist/` with TypeScript project references (chosen)
- Pros:
  - `tsc -b` builds `shared` → `db` → `api` in the right order and only rebuilds what changed. One `tsc -b -w` watches them all.
  - Production runs plain JavaScript. No extra tool: TypeScript is already here.
- Cons:
  - Two tsconfigs per package (`tsconfig.json` to check, `tsconfig.build.json` to emit).
  - Node reads `dist/`, so a build must run before `node` (not before tests or lint; see the decision).

#### Option B — Bundle the API (tsdown/esbuild/webpack)
- Pros: one output file, and workspace packages are inlined.
- Cons:
  - One more tool to learn and configure.
  - esbuild can't emit decorator metadata.
  - Stack traces point into a bundle.

#### Option C — Run `.ts` directly with Node's type stripping, using `.ts` import paths
- Pros: no build step in development.
- Cons:
  - Node refuses type stripping inside `node_modules`, which is exactly where `pnpm deploy` puts the packages in the image. Production would need a build anyway, so we'd have two ways of running.
  - Type stripping can't emit decorator metadata for the API itself.

### HTTP adapter
- **Express, Nest's default (chosen):** what Nest's docs and most examples assume, the largest middleware ecosystem.
- **Fastify:** faster, but speed is irrelevant at a shop counter, and some Nest examples need adapting.

### Logger
- **Nest's built-in `ConsoleLogger` with `json: true` in production (chosen):** structured JSON lines for stage 9's log tooling, no dependency.
- **pino via nestjs-pino:** faster and richer, but an extra dependency we don't need yet. Easy to swap in later behind Nest's logger interface.

### Creating the app
- **Hand-written, about eight files (chosen).**
- **`nest new`:** generates its own Jest, ESLint and Prettier setup, which would clash with the repo's Vitest and shared lint config (ADRs 0013, 0018) and have to be deleted.

### Container image
- **`node:24-slim`, multi-stage (chosen):** Debian, like `postgres:18` (ADR 0019). The build stage has pnpm and TypeScript. The runtime stage has only the app and its production dependencies, and runs as the non-root `node` user.
- **`node:24-alpine`:** smaller, but uses musl (the same reason we chose Debian for PostgreSQL).
- **Distroless:** smallest and no shell, but hard to debug while learning. Revisit at stage 10.

## Decision

1. Workspace packages export three conditions:
   - `source` → `src/*.ts`;
   - `types` → `dist/*.d.ts`;
   - `default` → `dist/*.js`.
2. `tsconfig.base.json` sets `customConditions: ["source"]`, and the API's Vitest config adds `source`. So type-checks, lint and tests read TypeScript sources and need no build. Node ignores `source` and runs `dist/`.
3. Each package has `tsconfig.build.json` (`composite`, `rootDir: src`, `outDir: dist`, tests excluded). The API's references `packages/db`. `pnpm build` runs `tsc -b` everywhere. `pnpm dev` runs `tsc -b -w` and `node --watch dist/main.js` together (pnpm's parallel script runner, no extra tool).
4. NestJS 12 on Express. `ConsoleLogger({ json })`, with JSON when `NODE_ENV=production`.
5. `apps/api/Dockerfile`, multi-stage on `node:24-slim`:
   - pnpm comes from Corepack;
   - `pnpm deploy --prod` copies the API with only its production dependencies;
   - the container runs as `node`;
   - one image with three commands: `dist/main.js` (default), `dist/worker.js`, `dist/migrate.js`.

   pnpm 12's `deploy` needed no extra setting (`injectWorkspacePackages`).
6. **Shutdown:** `api` and `worker` both wait in `waitForShutdown()` for SIGTERM (`docker stop`) or SIGINT (Ctrl+C), then call `app.close()` (finish requests, close the pool) and exit 0.
   - Compose runs them with `init: true`, so a tiny init process is PID 1 and passes the signal on.
   - Nest's `enableShutdownHooks()` is not used: it re-raises the signal, so a clean stop would exit 143.
   - The helper keeps a timer running, because signal listeners alone don't keep Node alive. Found when the first Docker run's worker exited after pg's 10-second idle timeout.
7. **Logging errors:** only `describeError(error)` is logged: the messages along the `cause` chain, each cut at Drizzle's `params:`.
   - pg-pool attaches the client to idle-connection errors. Its password is hidden, but serializers that read hidden properties print it.
   - Drizzle hides the real reason in `cause`, and its messages carry query values.
   - `runProcess()` wraps each entry point, so a crash at startup is also one messages-only line and exit code 1.
   - The worker treats an unreachable database at startup as a warning, not a crash, so Docker doesn't restart it in a loop.
   - The API listens on `HOST`, by default `127.0.0.1` (this computer only); `compose.yaml` sets `0.0.0.0` inside the container.
8. No secret is ever part of the image: no `ARG`/`ENV` values, and `.dockerignore` excludes `.env*` (`docs/devops/secrets.md`).

## Why

The API needs a compiler for decorator metadata anyway, so compiling the small workspace packages with the same compiler adds the least. Export conditions keep the everyday loop (test, lint, editor) free of build steps, while production runs only compiled JavaScript. The other choices take Nest's defaults and add nothing we don't need yet.

## Consequences

- New workspace packages copy the same `exports` shape and add a `tsconfig.build.json`. If the API imports a package, its `references` must list it.
- Never add a decorated class through `import type`; injection here uses tokens with `@Inject(...)`, which don't depend on metadata. The first class-injected service (P1.x) must prove that Vitest keeps decorator metadata. ADR 0013 names the SWC plugin for this; check first whether Vitest 5's own transform already does it.
- ESLint allows decorator-only classes (`no-extraneous-class` with `allowWithDecorator`), because that's what a Nest module is.
- The first image build downloads every dependency (slow on a slow connection); later builds reuse the cached install layer until the lockfile changes.

## Interview note

NestJS needs a compiler for decorator metadata, so I compile everything with TypeScript project references: `tsc -b` builds the shared packages and the API in order and incrementally. Packages export a custom `source` condition, so tests, lint and the editor read TypeScript directly without building, while production runs only compiled JavaScript. It ships as one slim, non-root Docker image with three commands (api, worker, migrate), and no secret ever enters an image layer.
