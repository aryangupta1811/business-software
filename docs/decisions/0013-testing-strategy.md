# 0013 — Testing: Vitest, real PostgreSQL with Testcontainers, Playwright

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

`CLAUDE.md` rule 8: no bugs, and tests for every business rule (GST math, stock, udhaar balances, salary and advances). The riskiest behaviour sits in the database: transactions, row locks, Row-Level Security, the missing `DELETE` grant (ADRs 0006, 0007).

## Options considered

### Option A — Unit tests with mocked or in-memory databases (e.g. SQLite)
- Pros: very fast.
- Cons: mocks and SQLite don't have PostgreSQL's locks, RLS or grants, so the most important bugs are invisible.

### Option B — Unit tests for pure logic + integration tests on a real PostgreSQL via Testcontainers + a few end-to-end browser tests
- Pros: tests what actually runs in production; concurrency and data-separation bugs become testable.
- Cons: needs Docker on the developer machine and in CI; integration tests are slower.

## Decision

Option B.

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest | Pure business rules in `packages/shared` and services: GST, money and rounding, stock maths, udhaar balances, salary and advances |
| Integration | Vitest + Testcontainers (PostgreSQL) | Transactions, rollback halfway through a bill, two counters selling the last unit, RLS across businesses, delete attempts failing, idempotent retries, invoice numbering |
| End to end | Playwright | Key flows in a real browser: sign up → add item → bill with the scanner → print preview; English and Hindi |

- Business rules are built test-first (`superpowers:test-driven-development`).
- One test runner (Vitest) for the whole repo. NestJS defaults to Jest, so the API uses Vitest with the SWC plugin so decorators keep their metadata.
- CI runs all three layers (ADR 0012).

## Why

The bugs that would break "zero data loss" and "data separation" only exist in a real PostgreSQL. Testcontainers makes a disposable real database as easy to use as a mock.

## Consequences

- Docker Desktop is needed on the Windows machine for integration tests (also needed for Docker Compose).
- Keep the pyramid: many fast unit tests, fewer integration tests, a handful of end-to-end tests.
- Demo data (ADR 0016) also serves as a large realistic fixture.

## Interview note

I test business rules like GST and salary maths with fast unit tests, but the bugs I fear most live in the database (locks, Row-Level Security, all-or-nothing saves), so I run integration tests on a real PostgreSQL in a throwaway container. For example, a test simulates two counters selling the last unit at the same moment and checks stock never goes wrong silently. Playwright covers the full billing flow in a real browser.
