---
name: start-session
description: Start a work session by loading the project state from files and proposing one task.
disable-model-invocation: true
argument-hint: "[optional: the task I want to do]"
---

Start a new work session on this project. You have no memory of earlier sessions; the files are the memory.

1. Read `docs/PROGRESS.md` and `docs/HANDOFF.md`. Don't read other docs yet.
2. Run `git status` and `git log --oneline -5`. If there are uncommitted changes, or the branch isn't `main`, tell me first.
3. Tell me in at most 6 lines: where the project stands, what is half-done, the next step, and anything under "Watch out for".
4. Propose ONE task for this session. If I gave a task in the arguments ("$ARGUMENTS"), use that instead.
5. Wait for my OK. Then read only the files that task needs (the table in `CLAUDE.md` says which).
6. Create the task's branch from the latest `main`: `git switch main`, `git pull`, `git switch -c type/short-name` (`docs/devops/git-workflow.md`). If the task continues a half-done branch, switch to that branch instead.
