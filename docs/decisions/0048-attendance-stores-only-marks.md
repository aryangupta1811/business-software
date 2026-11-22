# 0048 — Attendance stores only the marks people make; every other day takes its default

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

P2.3 adds the daily attendance register (design `docs/plans/2026-11-22-p2.3-staff-attendance-design.md`; Module 05 #5–#9, #29). The owner decided that everyone starts the day as present (`05` #5) and that a day nobody marked counts as its default: present, or the person's weekly off, or a shop holiday (`05` #29). P2.4 will work out salaries from these days, and P2.8 will send "2 absent, 1 on leave" in the daily summary, so every module must read a day the same way.

The question is what the database holds for a day nobody touched. Zero data loss is the top requirement (`product-overview.md`), and a salary must be repeatable: the same month must give the same pay next year.

## Options considered

### Option A — store only the marks people make; a function gives every other day its default
- Pros: nobody has to save a register every day, and a forgotten day still has a sensible answer. Changing someone's weekly off or adding a shop holiday needs no row to be rewritten, so no stale rows. A year of one person is a few dozen rows, not 365. One pure function, `dayStatus`, is the only place the rule lives, so the register, the month view, the summary and P2.4's pay cannot disagree.
- Cons: "what was this day?" needs the person's record and the holiday calendar as well as the marks, so a report can't be a plain `select`. A default can change later when the weekly off or a holiday is edited, so P2.4's finalized-month lock (`05` #19) must freeze the days it used.

### Option B — a row per person per day, created every night by the worker
- Pros: one query answers any day; reports are plain selects.
- Cons: a nightly job that must never miss (a missed night leaves holes, and a shop's computer is off at times). Changing a weekly off or adding a holiday must also fix every future row. 365 rows a year per person for days nobody touched. Defaults get copied into the table and then look like decisions somebody made.

### Option C — a row per person per day, created when the register opens
- Pros: no worker needed.
- Cons: opening a screen (a read) writes data; two counters opening it at once race to insert; and days nobody opened have no row anyway, so the rule for those is needed regardless.

## Decision

Option A. `attendance_marks` holds one row per person per day that somebody marked (unique on person and date), updated in place with a `version`; the entry log keeps every before and after (ADR 0028). A day with no row is whatever `dayStatus(person, date, holidays, mark)` says, in `packages/shared`: the mark if there is one, else weekly off on the person's weekly off day, else holiday on a live shop holiday for their branch or every branch, else present. A person is not on the register before their joining date or after the day they were deactivated. The same rows rule makes the other P2.3 tables small:

- `salary_rates` is append-only like `bills` (ADR 0047): the migration revokes `UPDATE` from `app_runtime`, `DELETE` was never granted, and the guard test's `APPEND_ONLY` list fails the build if either comes back. The rate for a month is the row with the latest `from_month` on or before it, and the later row wins a tie, so any old slip can be worked out again.
- `shop_holidays` rows are archived, never deleted (ADR 0007).
- Two counters saving the same day: the second sees `409 changed` with the latest row, and a save sent with `version: null` for a day that has a row is refused the same way.

## Why

- A forgotten day has an answer, and the owner marks only the exceptions: that is what "everyone starts as present" means in a shop.
- One function owns the rule, so a change to it (for example a "half-day weekly off") is one change with one test file.
- Few rows, no nightly job, nothing written by a read.

## Consequences

- P2.4 must freeze a month when it is finalized: either store the resolved days on the salary run or lock the inputs (marks, weekly off, holidays) for that month. The register's write path gets the finalized-month check then (design section 2).
- Reports over many people read marks, holidays and records and call `dayStatus`, not one table; the counts for a month are `monthCounts` over the days.
- A weekly off or holiday added later changes the default of days that were never marked. For past days that is a correction; the owner adds a mark where the old default was right. Days after today can't be marked at all (`05` #32), so nothing is promised ahead.
- Removing a mark isn't possible (no `DELETE`); to go back to "present" the owner marks present.

## Interview note

A register can store every day or only the exceptions. I stored only the exceptions: a person has a mark row only on days somebody changed, and a pure function in the shared package says what every other day is (weekly off, holiday or present). Nothing has to run every night, a missed day still has an answer, and the salary, the daily summary and the screen all call that one tested function, so they can't disagree. The trade-off is that a day's status isn't one column to query, and a later change to a weekly off changes the default of unmarked past days, so the salary module has to lock a month when it is finalized.
