# Business Software

[![CI](https://github.com/aryangupta1811/business-software/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aryangupta1811/business-software/actions/workflows/ci.yml)

One web app to run an Indian shop end to end: GST billing, inventory, udhaar (customer credit), suppliers, staff attendance and salary, an audit log, alerts, a dashboard and an AI assistant, in English, Hindi and Hinglish. Many businesses can sign up, and the database itself keeps each one's data apart. Nothing is ever hard-deleted.

**Status:** Phase 0 (foundations). The plan and progress are in [`docs/PROGRESS.md`](docs/PROGRESS.md).

**Stack:** TypeScript monorepo (pnpm). React + Vite web app, NestJS API and worker, PostgreSQL + Drizzle with Row-Level Security. Docker Compose locally, GitHub Actions CI, AWS (EC2 + RDS) through Terraform. The reasons for each choice are in [`docs/decisions/`](docs/decisions/).

## Run it

Needs Node 24+, pnpm 12 and Docker Desktop.

```bash
pnpm install
cp .env.example .env      # then replace the change-me values
pnpm db:up                # PostgreSQL in Docker
pnpm dev                  # API and web app: http://127.0.0.1:5173
pnpm check                # format, lint, type-check, tests
```

All the commands are in [`CLAUDE.md`](CLAUDE.md), and the database runbook is [`docs/devops/local-database.md`](docs/devops/local-database.md).

## Docs

| Where | What |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | How the system fits together, with diagrams |
| [`docs/requirements/`](docs/requirements/) | What each module must do |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |
| [`docs/devops/`](docs/devops/) | DevOps roadmap, git workflow, secrets, database runbook |
| [`docs/journal/`](docs/journal/) | Build journal and interview log |
