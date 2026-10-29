---
name: end-session
description: End a work session by saving everything important into the project files and committing, so nothing depends on chat history.
disable-model-invocation: true
---

End this work session. The next session starts with no memory of this chat. Anything not written into a file now is lost.

1. **Requirements.** If a requirement was clarified or changed, update that module file and add a dated line to its Change log. If I confirmed a DRAFT or "Proposed by Claude" point, mark it decided.
2. **Decisions.** If a tech decision was made without an ADR, write one now (follow `/record-decision`).
3. **`docs/PROGRESS.md`.** Tick finished tasks. Update "Current focus", "Next step" and "Last updated" (today's date).
4. **`docs/HANDOFF.md`.** Overwrite it with this session: what was done, what is half-done (with file names), the exact next step, and what to watch out for. Keep the format already in the file.
5. **Journal.** If a phase task finished, add to `docs/journal/phase-N.md`: what was built, choices vs alternatives (link ADRs), mistakes and what I learned, and interview questions I can now answer.
6. **`CLAUDE.md`.** If anything there is now wrong (e.g. run/test commands), fix it. Keep it short.
7. Show me a short list of what changed in the docs and wait for my OK.
8. Commit everything with a clear message. Don't push; remind me to run `git push`.
9. Print a 3-line summary I can paste into my notes.
