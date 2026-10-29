# Handoff — latest session

Overwritten at the end of every session. Older handoffs are in git history: `git log -p docs/HANDOFF.md`.

**Session:** 0 — planning chat on claude.ai, 2026-10-29

**Done:**
- Product idea reviewed against Vyapar, myBillBook and Khatabook.
- Module 00 (business setup, users & roles) and Module 01 (items & inventory) decided.
- Modules 02–09 drafted from the planning discussion. Not decided yet.
- This folder set up as the project's memory.

**Half-done:** nothing.

**Next step:** kickoff session — tech stack and architecture. The prompt is in `START_HERE.md`.

**Watch out for:**
- Offline billing (open question 1 in `product-overview.md`) is the biggest architecture decision. Settle it before choosing the stack.
- Module 00 says every action is recorded against the logged-in person. The entry log must record from the very first feature, not be added later.
- The non-functional requirements (zero data loss etc.) were proposed by Claude while importing. Confirm them with the owner.
