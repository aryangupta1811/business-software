---
name: record-decision
description: Record a technical decision as an Architecture Decision Record (ADR) in docs/decisions/. Use whenever a tech, architecture or infrastructure choice is made.
argument-hint: "[short title of the decision]"
---

Record this decision: $ARGUMENTS

1. Check `docs/decisions/` for the next number (0001, 0002, …) and make sure no existing ADR already covers it.
2. Create `docs/decisions/NNNN-short-title.md` from `docs/decisions/0000-template.md`, filled in from what we discussed. Include the options I rejected and why.
3. If it replaces an older ADR, set the old one's Status to `Replaced by NNNN`.
4. Add a row to the table in `docs/decisions/README.md`.
5. Add an entry to `docs/journal/INTERVIEW_LOG.md` that links the ADR: what we chose, why, and how to say it in an interview.
6. Show me the ADR and wait for my OK before committing.
