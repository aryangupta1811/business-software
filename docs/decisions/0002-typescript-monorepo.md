# 0002 — TypeScript everywhere, in a pnpm monorepo

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Kickoff step 5: choose the stack. The owner asked for the best stack regardless of what they already know (`CLAUDE.md`: "The tech stack is open"). What matters: correct business rules (GST, stock, udhaar, salary), building speed for one developer, and interview value.

## Options considered

### Option A — TypeScript: React frontend + NestJS backend
- Pros: one language for screen and server; types, validation schemas, GST and money code are written once and shared; huge ecosystem; strong demand at product companies.
- Cons: Node.js runs JavaScript on one thread, so heavy work (PDFs, Excel import) must move to a worker.

### Option B — Python: React frontend + FastAPI backend
- Pros: simplest backend syntax; best ecosystem for AI and data work.
- Cons: two languages; types and validation written twice; nothing shared with the screen.

### Option C — Java: React frontend + Spring Boot backend
- Pros: very mature; strong in service companies and banks; excellent transaction support.
- Cons: two languages; the most code to write; slowest to build for a first project; heavier containers need more memory (more cost).

## Decision

Option A. TypeScript in strict mode for all code, in one pnpm workspace repo:

```
apps/web          React app (counter screen)
apps/api          NestJS API + background worker
packages/shared   types, Zod schemas, money and GST logic (no framework code)
```

## Why

- The hard requirements (data safety, data separation, several counters) come from PostgreSQL in every option (ADRs 0005–0007). So the language mostly decides how fast and how correctly we can build.
- Shared code means a GST rule or a form check exists once: the screen shows exactly what the server will save.
- pnpm is fast, saves disk space, and is strict: code can't import a package it didn't declare.

## Consequences

- `packages/shared` must stay free of React and NestJS code so both sides can use it.
- Plain pnpm workspaces to start. A build orchestrator such as Turborepo is added only if builds get slow.
- Strict TypeScript settings from day one. Turning them on later means fixing hundreds of errors at once.

## Interview note

I compared TypeScript, Python and Java backends and saw that my safety requirements came from the database, not the language. The deciding factor was sharing code between the counter screen and the server: validation and GST math are written once and used on both sides. The trade-off is Node's single thread, which I handle by moving heavy jobs to a separate worker process.
