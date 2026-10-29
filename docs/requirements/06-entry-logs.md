# Module 06 — Entry logs

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 06`.

## Owner's brief

"Entry logs: whatever every staff member enters in the system should show in the entry log for the owner to review."

## Already decided elsewhere

- Every action is recorded against the person logged in → `00` #20
- Stock adjustments are recorded in the entry log → `01` #11

**Important for the build order:** recording must exist from the first feature that changes data. Only the viewer screen can come later. Adding logging afterwards means the early history is missing.

## Draft ideas

- Each entry shows who, what, when, and the old value → new value.
- Watched closely: bill cancellations, discounts, price changes, stock edits, attendance edits.
- Nobody — not even the owner — can edit or delete a log entry.
- Automatic flags for unusual patterns, such as many cancellations or entries late at night.
- Filters by staff member, date and type of action.

## Questions to settle

- Are the owner's own actions logged too?
- How long are logs kept?
- Which patterns count as "unusual", and who sees the flags?

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
