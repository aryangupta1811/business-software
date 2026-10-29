# 0004 — Backend: NestJS modular monolith

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

The backend serves ten requirement modules (00–09). A bill must save the bill, its stock movements, its udhaar entry and its entry-log rows together or not at all (`product-overview.md` NFR 1). Permissions are per staff login (Module 00 #17). One developer builds and runs it.

## Options considered

### Option A — NestJS modular monolith
- Pros: one app and one database, so a business action is one database transaction; NestJS gives modules, dependency injection (easy to swap real parts for fakes in tests), guards (a permission check per route) and interceptors; a well-known structure in Indian product companies.
- Cons: decorators and framework concepts to learn; some boilerplate.

### Option B — Minimal framework (Fastify / Express) with our own structure
- Pros: less framework, faster start.
- Cons: we'd hand-build the structure, dependency wiring and guards that NestJS already provides, and the structure would rest on discipline alone.

### Option C — Microservices (one service per module)
- Pros: independent deployment and scaling per service.
- Cons: a bill touches billing, stock and udhaar, so one transaction becomes a distributed saga; many deployments, more cost, more failure modes. It solves team-scaling problems we don't have.

## Decision

Option A. One NestJS codebase split into modules that mirror the requirement files, plus shared core modules:

- **Core:** tenancy (current business and branch), auth and sessions, permissions, entry log, database and transactions.
- **Domain:** business setup (00), items and inventory (01), billing (02), udhaar (03), suppliers (04), staff (05), entry-log viewer (06), alerts (07), dashboard (08), AI assistant (09).

One container image with two entry points: `api` (HTTP requests) and `worker` (background jobs, ADR 0010).

## Why

- A single transaction across modules is the most important technical need, and only a monolith with one database gives it cheaply.
- NestJS guards map directly onto per-staff feature switches, and interceptors are a natural place for request-level concerns.

## Consequences

- Module boundaries hold by convention: a module calls another module's service and never reads or writes another module's tables. We'll add a lint rule for imports once the code exists.
- Every write goes through one transaction helper that sets the current business (ADR 0006) and records entry-log rows (ADR 0007).
- If one module ever needs separate scaling, its clean boundary lets it be split out later.

## Interview note

I built a modular monolith because a bill has to update billing, stock and credit atomically, and that's a single database transaction in a monolith but a distributed saga across microservices. NestJS modules give the boundaries microservices would, without network calls between them. Microservices are mainly an organisational tool for many teams; for one developer they'd add cost and failure modes without benefit.
