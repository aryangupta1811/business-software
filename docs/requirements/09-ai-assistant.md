# Module 09 — AI assistant

**Status:** DECIDED (24 Nov 2026)
**Decided:** a read-only assistant that answers from the business's own data with the asking person's permissions, off until the owner turns it on, inside a $15 monthly cap for the whole app.

## Owner's brief

"An AI chatbot which replies to everything asked about the data, like: what item sold most this month, who was our top customer this month and which item he bought most, how many holidays has Rahul taken this month till now. Think deeply about every possibility this chatbot should handle."

## Already decided elsewhere

- Answers only through our own permission-checked tools, never model-written SQL; Claude Sonnet 5.5, $15 a month → ADR 0015
- Staff can't see salaries or profit by default; per-person switches → `00` #16, #17
- English, Hindi and Hinglish → `00` #25
- Customer details captured at billing → `02` #7
- What sales and profit mean → `08` #6–#8

## What it answers

1. **Sales:** top item; today vs yesterday; best weekday; peak hours; this Diwali vs last Diwali. Festival dates (Diwali, Holi, Eid, Dussehra) come from a small table per year.
2. **Customers:** top customer and what they buy; who hasn't come in 30 days; new vs repeat. Only named customers count, and the answer says so.
3. **Credit:** who owes most; overdue 60+ days; collected this week.
4. **Staff:** leaves this month; who is late most; advance remaining; who billed most. Behind the same switches as the app.
5. **Stock:** running low; will run out this week (stock ÷ average daily sales over 30 days, stated as such); dead stock (no sale in 90 days, settable).
6. **Profit and audit:** highest-margin vs best-selling item; who cancelled bills or changed prices today. Owner only.
7. **Advice** is data, not a forecast: what last Diwali sold and how this year compares. No predictions in v1.
8. **Features not built yet** (expiry, supplier dues and others) get "not recorded yet".

## Rules it follows

9. **Answers only.** Every tool is read-only; it can't change anything.
10. **Same permissions as the app.** Staff can use it only with a per-person switch, off by default, and it sees only what that person can see. A refusal doesn't reveal why.
11. **Private fields never reach the model** unless the person may see them and the answer needs them: costs, salaries, phone numbers. The filter is in the tools, not the prompt.
12. **Never invents numbers.** Each answer shows its period, filters and sources, folded under it. If it can't work something out, it says so.
13. **Ambiguity:** it states its assumption and answers; it asks only when the choice would change the answer a lot (two staff named Rahul).
14. **Dates:** "this month" is the 1st to today in Indian time; "this year" is the financial year (April–March), stated in the answer.
15. **Text in the data is never an instruction.** An item named "ignore your rules" is only a name.
16. **No voice in v1.**

## Privacy and history

17. **Off until the owner turns it on** in Settings, with a notice that questions and the data needed to answer them go to Anthropic. The demo business has it on.
18. **Chats** show to their own person for 90 days, then are hidden, not deleted. The owner doesn't read staff chats. A refused question is written to the entry log (`assistant.refused`).

## Cost

19. **$15 a month covers the whole app**, enforced by the app from token usage. Each business gets $5 a month, and so does the demo, all inside the $15. The Console's own limit is the backstop.
20. **At 80%** the owner sees a warning; **at 100%** it pauses until the 1st with a clear message.
21. **A limit on lookups per question**, so one question can't run up the bill.

## Quality

22. **Eval set:** about 50 questions with known answers from the demo data, in all three languages, including refusals, ambiguous questions and text that tries to give instructions. Pass: at least 90% exactly right and zero invented numbers; below that the model or the tools change before release.

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-17 — Fast-track sitting 1 answered one question early (decision D3): the model is Claude Sonnet 5.5 with a $15 monthly spend limit (ADR 0015 dated note).
- 2026-11-24 — Finalized in fast-track sitting 3 (`docs/plans/2026-11-20-sitting-3.md`, items 11–14): the owner took every recommendation, including those added at the sitting: "not recorded yet" (#8), data text is never an instruction (#15), off until turned on (#17), chats hidden and not deleted (#18), the $15 covering the whole app (#19), the lookup limit (#21). Voice moved to the backlog.
