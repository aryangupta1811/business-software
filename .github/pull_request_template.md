## What and why

<!-- One or two lines. Which task is this (e.g. P1.7 Items, Module 01)? -->

## How I checked it

<!-- Tests and commands run, screens tried. -->

## Checklist

- [ ] Title follows Conventional Commits, e.g. `feat(items): add barcode lookup` (it becomes the commit on `main`)
- [ ] Tests cover every business rule touched (GST math, stock, udhaar balances, salary and advances)
- [ ] No secrets, `.env` files or real customer data
- [ ] Database: no hard deletes and no destructive migration (zero data loss)
- [ ] Migration: the release before this one still runs on the new schema (expand, then contract), so a failed deploy can roll back to it
- [ ] Docs updated: `PROGRESS.md`, an ADR for any tech choice, an `INTERVIEW_LOG.md` entry
