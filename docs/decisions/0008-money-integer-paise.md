# 0008 — Money stored as integer paise

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

All amounts must be exact to the paisa, with GST rounding done the way the rules require (`product-overview.md` NFR 4). Loose items are sold by weight (Module 01 #2), so quantities can be fractions.

## Options considered

### Option A — Floating-point numbers
- Pros: simplest to write.
- Cons: can't represent most decimals exactly (`0.1 + 0.2 = 0.30000000000000004`); errors build up across bills and reports. Unacceptable for money.

### Option B — Decimal type (PostgreSQL `NUMERIC` + a decimal library in code)
- Pros: exact; reads naturally.
- Cons: a library object on every calculation; easy to mix with plain numbers by mistake; the database driver returns `NUMERIC` as strings.

### Option C — Integers in the smallest unit (paise)
- Pros: exact; fast; works with plain JavaScript numbers; impossible to get a stray fraction of a paisa.
- Cons: must convert at the edges (display, input), and every division needs an explicit rounding rule.

## Decision

Option C.

- **Money:** whole paise as `bigint` in PostgreSQL and plain integers in TypeScript (₹12.50 → `1250`). JavaScript integers are exact up to 2^53, about ₹90 lakh crore in paise, far above any shop's totals.
- **Tax rates:** basis points (18% → `1800`).
- **Quantities:** a fixed number of decimal places stored as an integer of thousandths of the unit (0.250 kg → `250`). Confirm when building Module 01.
- **Rounding:** happens only inside `packages/shared` money and GST functions, each with a named rule. The exact GST rounding rules (per line or per bill, invoice round-off to the rupee) are decided when finalizing Module 02.

## Why

Integers make exactness the default instead of something to remember. Keeping all rounding in one tested place means the screen, the bill, the PDF and the reports can never disagree.

## Consequences

- Every amount is formatted for display in one helper (Indian grouping: ₹1,23,456.78).
- Splitting an amount (e.g. a discount spread across lines) uses an allocation function that hands out the leftover paise deliberately, so the parts always add up to the total.
- Tests for every rounding and allocation case, because GST math is a business rule (`CLAUDE.md` rule 8).

## Interview note

I never let a floating-point number touch money: amounts are integers in paise, tax rates are basis points, and quantities are integer thousandths of a unit. All rounding lives in one shared, heavily tested module, so the bill on screen, the printed invoice and the reports always agree to the paisa. JavaScript integers are exact up to 2^53, which is about ₹90 lakh crore in paise, so plain numbers are safe.
