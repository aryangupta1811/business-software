# Start here

This folder is the project's memory. Everything decided in the planning chat on claude.ai is in `docs/requirements/`. Claude Code reads these files at the start of every session, so nothing depends on chat history and a full context window can't lose anything.

## Why nothing gets lost

- **Decisions live in files, not chats.** A chat can end, get compacted or be cleared. Files stay.
- **The files live in git.** Every change is a saved version you can go back to.
- **The repo is pushed to a private GitHub repo.** If your laptop dies, nothing is lost.
- **Claude Code reads `CLAUDE.md` automatically every session**, and again after the conversation is compacted. `CLAUDE.md` tells it where everything else is.
- **Every session ends with `/end-session`**, which writes what happened into `docs/PROGRESS.md` and `docs/HANDOFF.md` and commits. The next session starts from those files.

## One-time setup

Do this before anything else.

1. Unzip this folder where you keep your projects.
2. Open a terminal in it and save the first version:
   ```bash
   cd business-software
   git init
   git add .
   git commit -m "Import requirements from planning chat"
   ```
3. On GitHub, create an empty **private** repository called `business-software` (no README). Then:
   ```bash
   git remote add origin https://github.com/<your-username>/business-software.git
   git branch -M main
   git push -u origin main
   ```
   Your requirements are now safe, even before any code exists.
4. Start Claude Code in the folder: `claude`
5. Paste the kickoff prompt below.

From now on, **these files are the source of truth.** The claude.ai doc "Business Software – Requirements" is an archive. Don't edit both, or they will drift apart.

## Kickoff prompt

Paste this in your first Claude Code session:

```text
Read CLAUDE.md, docs/requirements/README.md, docs/requirements/product-overview.md, docs/devops/DEVOPS_PLAN.md and docs/PROGRESS.md. Read modules 00 and 01 fully (they are DECIDED) and skim 02–09 (DRAFTS).

Don't write any code in this session. The goal is to choose the technology and architecture, and to teach me how this is done on a real project.

1. In about 10 bullets, tell me what you understood. List anything unclear or contradictory.
2. Ask me what I already know (languages, frameworks, cloud, DevOps tools) in one short question.
3. Confirm the non-functional requirements in product-overview.md with me.
4. Go through the open architecture questions in product-overview.md with me, one at a time, with your recommendation for each.
5. Propose 2–3 complete stack options (frontend, backend, database, hosting/cloud, AI, WhatsApp, printing). Compare them on: data safety, keeping each business's data separate, several counters billing at once, Hindi support, DevOps learning value, cost for a student, interview value, and difficulty for me. Recommend one and explain why.
6. After I choose, record each decision with /record-decision, write docs/architecture.md with a simple diagram, and break Phases 1–3 in docs/PROGRESS.md into tasks small enough for one session each, with the DevOps stages woven in.
7. If we run out of room before finishing, stop at a clean point and run /end-session.
```

## Every session after that

1. `cd business-software` and run `claude`.
2. Type `/start-session`. Claude reads `PROGRESS.md` and `HANDOFF.md` and tells you where things stand and what to do next.
3. Work on **one thing**: one module's requirements, one decision, one feature, or one DevOps stage.
4. Type `/end-session`. Claude saves everything into the docs and commits.
5. Run `git push`.
6. Optional: paste the 3-line summary from `/end-session` into your Notion Placement OS.

## Commands in this project

| Command | What it does |
| --- | --- |
| `/start-session` | Loads the project state from files and proposes one task |
| `/end-session` | Saves decisions, progress and handoff notes into files, then commits |
| `/finalize-module 02` | Turns a DRAFT module into DECIDED, the same way we did Modules 0 and 1 |
| `/record-decision <title>` | Writes an Architecture Decision Record for a tech choice |

## When the context window fills up

- Type `/context` any time to see how full it is.
- When it's around two-thirds full, or you're switching to a different task: `/end-session`, then `/clear`, then `/start-session`. You lose nothing, because everything important is now in files.
- Don't count on automatic compaction to keep details. It keeps a summary and can drop specifics. `CLAUDE.md` is re-read after compaction; things said only in chat are not.
- If you must compact in the middle of a task, give it a focus: `/compact focus on <the task>`.
- For big searches through code, ask Claude to use a subagent. The subagent reads files in its own context and sends back only a summary.

## If something goes wrong

- **Claude made a bad change:** `/rewind` goes back to an earlier point in the session. For committed work, use `git revert`.
- **Claude seems to have forgotten a decision:** ask it to read the relevant file in `docs/`. If the decision was never written down, write it down now.
- **A requirement changed:** edit the module file (or ask Claude to), with a Change log line. Never only say it in chat.

## Using your Claude Pro plan well

Short, focused sessions use less of your usage limit than one long chat. Starting fresh with `/clear` after `/end-session` is cheaper than dragging an old conversation along.
