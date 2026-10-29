# 0005 — Database: PostgreSQL with Drizzle ORM

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

The data is relational: businesses, branches, items, bills with lines, stock movements, udhaar ledgers, staff, attendance. The NFRs need all-or-nothing saves (NFR 1), data separation (NFR 2), correctness with several counters (NFR 3), exact money (NFR 4) and fast item search, including Hindi names (NFR 5, 7).

## Options considered

### Database

#### Option A — PostgreSQL
- Pros: full ACID transactions; row locks (`SELECT … FOR UPDATE`); Row-Level Security for tenant separation; CHECK and foreign-key constraints; JSONB for business-type-specific item fields; `pg_trgm` for fast fuzzy search; managed on AWS RDS with point-in-time restore.
- Cons: schema changes need migrations (a good thing here).

#### Option B — MySQL
- Pros: also relational and widely used.
- Cons: no Row-Level Security; weaker constraint and JSON features.

#### Option C — MongoDB
- Pros: flexible documents.
- Cons: bills, lines and ledgers are relational; multi-document transactions are possible but not its strength; no equivalent of RLS policies.

### Database access

- **Drizzle ORM (chosen):** typed queries that read like SQL; migrations generated as plain SQL files we review; easy to drop down to raw SQL for locks and RLS policies.
- **Prisma:** popular, but its generated client hides SQL, and transaction-scoped session settings (needed for RLS) are awkward.
- **Raw SQL only:** maximum control, but no type safety on results.

## Decision

PostgreSQL (the newest version AWS RDS supports when we set it up, with the same version locally and in CI). Drizzle ORM for queries and drizzle-kit for migration files committed to git.

## Why

PostgreSQL is the only option that gives transactions, row locks and database-enforced tenant separation together. Drizzle keeps SQL visible, which matters because locks and policies are core to correctness and are things to explain in interviews.

## Consequences

- Migrations are code-reviewed like code and are never destructive without the owner's OK and a fresh backup (`CLAUDE.md` rule 7). Changes use expand → migrate → contract: add the new column, move the data, remove the old one only later.
- Indexes lead with `business_id` (ADR 0006).
- Pin the PostgreSQL major version in Docker Compose, CI and Terraform so all environments match.

## Interview note

My data is relational with strict money rules, so I wanted a relational database with real transactions, and PostgreSQL adds row locks and Row-Level Security, which solve my concurrency and multi-tenancy problems inside the database. I chose Drizzle over Prisma because it stays close to SQL, so locks and policies aren't hidden behind an abstraction. Migrations are SQL files in git, reviewed like code and never destructive.
