# Module 06 — Entry logs

**Status:** DECIDED (19 Nov 2026)
**Decided:** every action, the owner's included, is logged for good with old → new values; nobody can edit, delete or backdate an entry; the owner reviews it with filters and three simple flag rules.

## Owner's brief

"Entry logs: whatever every staff member enters in the system should show in the entry log for the owner to review."

## Already decided elsewhere

- Every action is recorded against the person logged in → `00` #20
- Stock adjustments are recorded in the entry log → `01` #11
- One append-only table, written only through `recordEntry` in the same transaction as the action → ADRs 0007, 0028

**Important for the build order:** recording must exist from the first feature that changes data. Only the viewer screen can come later.

## What is logged

1. **Each entry:** who, what, when, and old value → new value. The viewer shows a readable diff.
2. **The owner's own actions are logged** (`00` #20). The viewer can hide them with a filter.
3. **Logins:** successful logins, logouts, owner lock and unlock, and every permission change are logged. Failed logins stay with the login rate limit, not the log.
4. **Nobody can change history:** not even the owner can edit or delete an entry, and only the database sets an entry's ID and time, so the app can't backdate one (decision D4).
5. **Corrections:** a mistake in a past action is fixed by a new action that refers to it; the viewer shows the pair together.
6. **Kept forever.** A future privacy request anonymises personal fields (names, phone numbers) and keeps the records (ADR 0007).

## Flags for unusual activity

7. **Three rules in v1,** each with a number the owner can change:
   - **Many cancellations:** one person cancels 3 or more bills in a day.
   - **Out-of-hours activity:** any change made outside shop hours (owner sets them; 08:00–22:00 by default).
   - **Big stock write-down:** one person's stock adjustments that reduce stock are worth more than ₹1,000 at purchase price in a day. The value at purchase price is stored in the `stock.adjusted` entry when it's written.

   Flags are worked out from the log when shown, not stored, so changing a number re-checks old days too. Rules 1 and 3 count by the action's business date (carried in the entry), not the time it was logged, so seeded demo history spreads its flags over the months it pretends.
8. **Who sees flags:** the owner, in the viewer, on the owner dashboard (`08`) and as a count in the daily summary (`07` #9). For staff, seeing flags is a feature switch that starts off (`00` #17).

## The viewer

9. **Filters:** staff member, date, type of action and branch, plus a one-click "watched actions" filter (bill cancellations, discounts, price changes, stock edits, attendance edits).
10. **Staff access:** the viewer is off for staff by default; the owner can switch it on per staff login. Seeing flags is a separate switch (#8).
11. **Readable names:** every action has a label in English, Hindi and Hinglish; times show in IST.
12. **Export:** the filtered log downloads as Excel, as part of "the owner can export all their data" (NFR 1).

## v1 delivery (the owner's portfolio cut, 2026-11-22 (`docs/plans/2026-11-17-fast-track.md`, section 9))

- **Recording (#1–#6) ships in v1 and already runs:** every action is logged from day one, so nothing is lost while the screens wait.
- **The flags (#7, #8) and the viewer (#9–#12)** wait in `ideas-backlog.md` ("Deferred from v1") as P2.6. When P2.6 is built it shows the whole history from the first day. Module 07's "suspicious activity" alert and the dashboard's flags (#8) come with it.

## Open questions

None. Moved to `ideas-backlog.md`: a fourth flag rule, "price lowered and raised back the same day".

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-10-29 — Kickoff session: noted that `00` #20 already answers the owner-logging question.
- 2026-11-19 — Finalized in fast-track sitting 2 (`docs/plans/2026-11-18-sitting-2.md`, items 1 and 7–10): the owner took every recommendation, with flag rules 1–3 only (rule 4 to the backlog), and answered D4 "yes": only the database sets an entry's ID and time.
- 2026-11-20 — Owner, P1.8 design (question 5, as recommended): #7's "value at purchase price" for a stock write-down is the branch's average cost of that stock (Module 01 #4), falling back to the item's purchase price when the item has no stock history. No numbered point changed.
- 2026-11-22 — Portfolio cut (owner): the viewer and flags (P2.6) deferred to the backlog; recording continues. No decided point changed.
