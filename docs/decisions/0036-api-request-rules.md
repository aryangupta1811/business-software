# 0036 — API request rules: shared Zod bodies, declared permissions, a guard that fails closed

- **Date:** 2026-11-18
- **Status:** Accepted

## Context

P1.3 adds the first routes that take a body (signup, settings). The 2026-11-10 scan asked that every body be checked by a shared schema before a service sees it (lengths, and no NUL, which PostgreSQL refuses in `text` and `jsonb`, so it would surface as a 500). The plan review asked that every route name its permission from the first route on, so P1.5's staff switches need no retrofitting. ADRs 0002 and 0003 already put Zod schemas in `packages/shared`, used by both the forms and the server. Login and sessions (ADR 0009) arrive in P1.4, a day later.

## Options considered

### Checking bodies

#### Option A — Zod schemas from `packages/shared` through a Nest pipe, errors as codes (chosen)
- Pros: one schema for the form and the API, so they can't disagree; the pipe runs before the handler; error *codes* (`too_long`) let the web app answer in English, Hindi or Hinglish.
- Cons: a route could forget the pipe, so a test has to check every route.

#### Option B — class-validator DTOs (Nest's usual way)
- Cons: a second schema language next to the forms' Zod; decorators the web app can't import; English messages.

### Who may call a route

#### Option A — `@Public()` or `@Permission('…')` on every route, a global guard that refuses a route with neither (chosen)
- Pros: forgetting is a 500 in the first test, never an open route; P1.5 only changes what a caller's permissions are.
- Cons: two decorators to remember; health and signup must say `@Public()`.

#### Option B — routes are open unless marked
- Cons: fails open, which is exactly the mistake that leaks data.

## Decision

- **Bodies.** Every `@Body()` takes `new ZodBodyPipe(schema)` with a schema from `packages/shared`. Schemas are strict (unknown fields refused). The shared `text(max)` helper trims, checks length and refuses Unicode control characters (`\p{Cc}`, which includes NUL); `optionalText` turns a blank into null. A bad body answers `400 { code: 'invalid_body', fields: { <field>: <code> } }`.
- **Permissions.** Names live in `PERMISSIONS` in `packages/shared`; the owner holds all of them. A global `PermissionGuard` lets `@Public()` routes through, answers 500 for a route with neither decorator, asks a `SessionResolver` for the caller (`401 not_logged_in` when there is none), and checks the permission (`403 forbidden`). The handler reads the caller with `@CurrentCaller()`.
- **Until P1.4**, the resolver is `NoSessionResolver`: nobody is logged in, so every non-public route answers 401. Tests pass a fake resolver to `createApp`.
- **Errors** stay as before: client errors are `HttpException`s with a `code`; anything else goes through `UnhandledErrorFilter`, which logs messages only.
- **A route census test** (`apps/api/src/routes.test.ts`) reads Nest's metadata for every controller in `API_CONTROLLERS` and fails on a route without `@Public()`/`@Permission()` or a `@Body()` without the pipe. It proves itself on a deliberately broken controller.

## Why

The database already fails closed (RLS shows nothing without a business); the HTTP layer should too. One schema shared by the screen and the server removes a whole class of "the form allowed it but the API refused it" bugs, and codes instead of sentences keep the server language-free.

## Consequences

- P1.4 replaces `NoSessionResolver` with the real session lookup; no route changes.
- P1.5 computes a staff caller's `permissions` from the owner's switches; no route changes.
- A new controller must be added to `API_CONTROLLERS`, or the census can't see it.
- Request types use Node's `IncomingMessage`, so the API needs no `@types/express`.

## Interview note

Every API route must declare who may call it, and a global guard treats a route without a declaration as a bug rather than an open door; a test walks Nest's metadata so a forgotten decorator fails CI. Request bodies are parsed by the same Zod schemas the forms use, from a shared package, so the screen and the server can't disagree, and errors come back as codes the frontend translates into three languages. Until login exists, the session resolver says "nobody", so everything except signup and health answers 401.
