# 0015 — AI assistant: Claude API, answering only through permission-checked tools

- **Date:** 2026-10-29
- **Status:** Accepted (model and monthly cap are chosen at the start of Phase 3)

## Context

Open question 3 in `product-overview.md`: which AI model and provider, and what monthly cost limit? Module 09 drafts set the rules: the assistant follows the same permissions as the app (a staff member asking for salaries is refused), never invents numbers, handles ambiguity, works in Hindi and Hinglish. It is built in Phase 3, months from now.

The owner chose Claude, at first planning to use their Claude subscription. **A Claude Pro/Max subscription does not include API access.** It covers claude.ai and Claude Code only. An app calls the Claude API with an API key from the Claude Console (platform.claude.com), billed separately: prepaid credits, with a spend limit you set. A subscription login or token must never be built into the app.

## Options considered

### Option A — Text-to-SQL (the model writes SQL against the database)
- Pros: flexible; any question can be tried.
- Cons: model-written SQL can read data the user isn't allowed to see (salaries, profit: Module 00 #16), can write wrong joins that look right, and is hard to test. Row-Level Security would stop cross-business leaks, but not per-staff permission leaks.

### Option B — Tool calling over a fixed set of our own read functions
- Pros: each function runs with the asking user's session, tenant and permission checks; every number in an answer comes from a function result; functions are normal, unit-tested code.
- Cons: a question that no function covers can't be answered until a function is added. Designing a few general functions (filtered sums and rankings) matters.

### Option C — Pre-built reports only, no language model
- Pros: cheap and exact.
- Cons: no natural-language questions, no Hinglish. Fails the owner's brief.

## Decision

- **Provider:** Anthropic Claude API, called from the `api` with the official TypeScript SDK. The key lives in SSM Parameter Store (ADR 0011) and never reaches the browser.
- **Pattern:** Option B. The model may only call our tools (e.g. `topItems(period)`, `customerRanking(period, by)`, `staffAttendance(staffId, month)`), each enforcing the user's permissions. Answers must be built from tool results.
- **Model and monthly cap:** chosen at the start of Phase 3, because models and prices change every few months. The app enforces a hard monthly spending cap per business.
- **Prices for planning** (Claude API, per million tokens, input / output, cached 2026-10-06): Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20. A typical question of about 10k input and 1k output tokens costs roughly $0.0015, $0.03 or $0.06 respectively. A few dollars of credit covers a portfolio demo.

## Why

Tool calling is the only option that can guarantee the two hardest rules, same permissions as the app and no invented numbers, while still understanding free-form Hindi and English questions.

## Consequences

- Phase 3 needs: a tools layer (read-only, permission-checked), the chat screen with streaming, and an **eval set** of questions with known answers from the demo data (ADR 0016) to measure accuracy.
- The owner creates a Claude Console account, adds a small amount of credit, sets a spend limit and creates an API key at the start of Phase 3. This is the one part of the project that can't be free (the hosting budget is ₹0, ADR 0011): it needs a small prepaid credit of a few dollars. Check the minimum purchase and any free options at that time.
- **Chosen 2026-11-17 (owner, fast-track sitting 1, decision D3): Claude Sonnet 5.5 (`claude-sonnet-5-5`), with a total cap of $15 a month.** Prices checked that day from Anthropic's current list (per million tokens, input / output): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50. Estimated cost per question with 2–3 tool calls: about $0.03–0.05 on Sonnet 5.5. The owner chose Sonnet 5.5; it costs half as much as the more capable default, Opus 5.5. The P3.4 eval set measures whether its accuracy is good enough; if not, the model is a one-line change and this note gets a follow-up. On Sonnet 5.5, `thinking: {type: "disabled"}` returns a 400: thinking is turned off with `{type: "between_tools"}` (effort `high` or below). It also doesn't accept a forced `tool_choice`. P3.3 follows the current API reference. The owner creates two keys (local and demo) by fast-track Day 7, in one workspace whose spend limit holds both to $15 a month (check in the Console where the limit is set).
- Whether the assistant may *act* (e.g. "mark Rahul absent") stays open in Module 09. Any action would go through the same services and entry log as the UI.
- **Added 2026-11-24 (owner, sitting 3, Module 09):** answers only in v1, so the line above is settled: no actions. The $15 is for the whole app, enforced by the app; each business gets $5 a month, the demo included (`09` #19). The assistant is off until the owner turns it on (`09` #17).

## Interview note

My AI assistant never touches the database directly: it can only call a fixed set of my own functions, which run with the asking user's permissions, so a staff member can't get salaries out of it and every number comes from real data. I rejected text-to-SQL because model-written queries can bypass permissions and fail silently. I measure accuracy with an eval set of questions whose answers are known from the demo data, and the app enforces a monthly spending cap.
