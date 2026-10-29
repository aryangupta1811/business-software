# Module 09 — AI assistant

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 09`.

## Owner's brief

"An AI chatbot which replies to everything asked about the data, like: what item sold most this month, who was our top customer this month and which item he bought most, how many holidays has Rahul taken this month till now. Think deeply about every possibility this chatbot should handle."

## Already decided elsewhere

- Staff can't see salaries or profit by default; the owner sets permissions per staff login → `00` #16, #17
- English and Hindi → `00` #25

## Draft ideas — questions it should answer

- **Sales:** top item; today vs yesterday; best weekday; peak hours; this Diwali vs last Diwali.
- **Customers:** top customer and what they buy most; who hasn't come in 30 days; new vs repeat customers.
- **Credit:** who owes the most; overdue for 60+ days; how much was collected this week.
- **Staff:** Rahul's leaves so far this month; who is late most often; advance remaining; who billed the most.
- **Stock:** what's running low; what will run out this week; dead stock.
- **Profit:** highest-margin item vs best-selling item (often different).
- **Audit:** who cancelled bills or changed prices today.
- **Advice:** how much of an item to stock before Diwali.

## Draft ideas — rules it must follow

This is where most AI features fail.

- **Same permissions as the app.** If a staff member asks "Rahul ki salary?", it refuses.
- **Handles ambiguity.** Two Rahuls, or "top customer" by money vs by visits: it asks, or states its assumption.
- **Honest about missing data.** Walk-in customers with no phone number can't be counted as top customers, so billing must capture customer details (Module 02).
- **Never invents numbers.** Every number comes from the business's data; if it can't work something out, it says so.
- **Hinglish and voice.** Most shopkeepers won't type in English.
- **Answers first, actions later.** Decide later whether it can *do* things like "Rahul ko absent mark karo".

## Questions to settle

- Which AI model/provider and monthly cost limit (open question 3 in `product-overview.md`).
- Voice input in v1, or later?
- Can staff use the assistant at all, and with which limits?
- Can it take actions, or only answer?

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
