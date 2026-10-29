---
name: finalize-module
description: Turn a DRAFT requirements module into DECIDED by going through it with the owner.
disable-model-invocation: true
argument-hint: "[module number, e.g. 02]"
---

Finalize the requirements for module $ARGUMENTS.

1. Read `docs/requirements/README.md`, `docs/requirements/product-overview.md` and the module file `docs/requirements/$ARGUMENTS-*.md`. Also read any DECIDED module it links to.
2. No code in this session. Keep it non-technical: what the shop needs, not how to build it.
3. Go through the module with me in small groups, 4–8 points per message, numbered. For each point give your recommendation in brackets with a one-line reason, so I can reply "go with yours" or list only the numbers I want to change. Point out gaps, edge cases and conflicts with other modules. Think about how real Indian shops work.
4. Settle the module's "Questions to settle" the same way.
5. Rewrite the file:
   - `Status: DECIDED (date)` and a one-line summary.
   - Decided points as a numbered list, grouped under short headings.
   - An "Already decided elsewhere" section that links to related points in other modules.
   - Any questions still open.
   - A dated Change log line.
6. Update the status table in `docs/requirements/README.md` and in `docs/PROGRESS.md`.
7. Commit with the message `Finalize requirements: module $ARGUMENTS`.
