# 0010 — Background jobs and WhatsApp: pg-boss, an outbox, and the WhatsApp Cloud API

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Owner alerts go out on WhatsApp (Module 00 #26, Module 07). Some work shouldn't run inside a web request: sending messages, daily summaries, PDFs, Excel imports. Open question 2 in `product-overview.md`: a real WhatsApp integration or a mock? The official WhatsApp Business API needs a verified business and charges per message.

## Options considered

### Job queue
- **A — pg-boss (a queue stored in PostgreSQL), chosen:** no new infrastructure; jobs are covered by the same backups; uses `SKIP LOCKED` so several workers never take the same job.
- **B — BullMQ + Redis:** very fast and popular, but Redis is one more service to run, pay for and secure.
- **C — AWS SQS:** managed, but ties local development to AWS and spreads state across two systems.

### WhatsApp
- **A — Real integration with Meta's WhatsApp Cloud API, using its free test number, chosen:** a genuine integration; the test number can message a few verified numbers (e.g. the owner's phone) at no cost.
- **B — Mock only:** easy, but shows nothing real.
- **C — A third-party provider (Twilio, Gupshup):** easier onboarding, but adds cost and a middleman.

## Decision

- Background jobs run in **pg-boss**, in the `worker` process (ADR 0004).
- **Outbox pattern:** a business action that needs to send a message inserts a notification row *in the same transaction*. The worker picks it up, sends it, retries with backoff on failure, and records the status.
- Message senders sit behind a small interface with two implementations: the **WhatsApp Cloud API** sender and a **log-only** sender for local development, tests and demo environments.
- An in-app **Outbox** page lists every message and its status, so the demo works even without WhatsApp.

## Why

- Sending directly inside a request goes wrong both ways: a crash after commit loses the message, and a message sent before a rollback announces something that never happened. The outbox fixes both.
- PostgreSQL as the queue keeps moving parts (and cost) down.
- A real integration is worth far more in a portfolio than a mock, and the test number makes it free.

## Consequences

- Delivery is at least once, so sending must be idempotent: each message carries its notification ID, and a resend after a timeout checks the status first.
- WhatsApp business-initiated messages must use templates approved by Meta. Template design is part of Module 07.
- Real production use (any customer's number) needs Meta business verification and per-message charges. That's out of scope for the portfolio and recorded here so it isn't a surprise.
- The access token lives in SSM Parameter Store (ADR 0011) and in a local `.env` that is never committed.

## Interview note

I used the outbox pattern: the WhatsApp alert is written to the database in the same transaction as the business action, and a worker sends it with retries, so a crash can't lose it and a rollback can't send it. The queue is pg-boss on PostgreSQL, so there's no Redis to run and the jobs are covered by the same backups. It's a real WhatsApp Cloud API integration using Meta's free test number, with a log-only sender for local development.
