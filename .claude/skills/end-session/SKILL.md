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
6. **Interview log.** Make sure `docs/journal/INTERVIEW_LOG.md` has an entry for everything notable this session (decisions, concepts, errors, bugs and their fixes, useful commands, gotchas), however small. Add what's missing, add new Question bank items and Glossary terms, and update the Pitch and Numbers if they changed.
7. **`CLAUDE.md`.** If anything there is now wrong (e.g. run/test commands), fix it. Keep it short.
8. Show me a short list of what changed in the docs and wait for my OK.
9. The repo is public: before committing, run the staged-changes gitleaks scan and the personal-data check from `docs/devops/git-workflow.md` (Secrets). Show me anything they find. Then commit everything on the task branch with a Conventional Commit message. Don't push. Remind me to push the branch (`git push -u origin HEAD`), open the pull request with `gh pr create --web` and the Conventional Commit title you suggest (it becomes the commit on `main`), fill in the template, squash-merge it once CI is green, then `git switch main`, `git pull` and `git branch -D <branch>`.
10. Print a 3-line summary I can paste into my notes.
