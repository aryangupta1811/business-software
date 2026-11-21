# Module 07 — Alerts

**Status:** DECIDED (19 Nov 2026)
**Decided:** grouped in-app alerts behind a bell, one daily WhatsApp summary to the owner, WhatsApp used only for digests and messages someone chooses to send, quiet hours at night, and every alert type switchable.

## Owner's brief

"It should give alerts to the owner and staff both that a particular item is short in inventory."

## Already decided elsewhere

- Owner alerts are sent on WhatsApp → `00` #26
- No phone app, so without WhatsApp the owner sees alerts only when someone opens the software → `00` #23
- Low-stock level is set per item, per branch → `01` #1
- Medical has expiry alerts on by default → `00` business-type table
- Udhaar reminders go out only after the owner approves the list; an optional weekly automatic send is off by default → `03` #15
- Bills and statements can be sent on WhatsApp → `02` #16, `03` #14
- The outbox and the Outbox page; real WhatsApp Cloud API with Meta's test number → ADR 0010, `product-overview.md` question 2
- Seeing flags from the entry log → `06` #8

## Alert types and who gets them

1. **Alert types:** low stock, out of stock, expiring soon, overdue udhaar, suspicious activity (entry-log flags, `06` #7). Supplier payments due waits for Module 04. Absent staff is a line in the daily summary (#9), not an alert.
2. **Who gets what:** the owner gets everything. Staff get low stock, out of stock and expiring soon, in the app only. Money alerts (overdue udhaar, later supplier dues) and entry-log flags start **off** for staff; the owner can switch them on per staff login (`00` #17).
3. **Switching off:** the owner can turn every alert type off, separately for the app and for WhatsApp. Defaults come from the business-type preset (`00` #1).
4. **Raised once, cleared by itself:** a low-stock alert is raised when an item's stock at a branch falls to or below its low-stock level, and isn't raised again until stock goes back above it. It clears itself when restocked. Out of stock works the same way at 0.
5. **Expiry window:** batches expiring within 30 days, owner-settable; checked once a day.

## In the app

6. **The bell:** a bell with a count in the top bar, alerts grouped by type ("7 items low on stock"). Never a pop-up while billing. Each person can dismiss an alert for themselves.
7. **Branches:** alerts belong to a branch. The owner sees all branches; staff see the branch they're logged into.

## WhatsApp

8. **Digests only.** WhatsApp carries only: (a) the daily summary; (b) udhaar reminders (the list the owner approves, or the optional weekly send, `03` #15); (c) bills and statements someone chooses to send. Low stock, expiry and flags go into the summary and the app, never one WhatsApp message per event.
   - Bills and statements are sent through the outbox with a template that has a **document header** (the PDF is uploaded to Meta first), so they show in the Outbox page like every other message. Three templates: summary, udhaar reminder, document.
9. **Daily summary to the owner:** sent at 21:30 IST by default (owner-settable). It covers everything since the last summary. Contents: sales total and bill count, split by payment mode (`02` #10), udhaar collected, items low or out of stock, batches expiring soon, entry-log flags, who was absent, and overdue udhaar by bucket (`03` #12). In the app it shows per branch with a total; on WhatsApp it carries fixed counts and totals plus "open the app for details".
10. **Once a day, even when the server was off:** at most one summary per business per day, recorded so a restart never sends a second copy. When the worker starts, it sends only the latest missed summary, marked "late"; older missed ones are skipped (the next summary still covers everything since the last one sent).
11. **Quiet hours:** no WhatsApp messages from 22:00 to 08:00 IST by default (owner can change both times). Automatic messages created then wait in the outbox until 08:00. A message a person chooses to send now (a bill, a statement, reminders just approved) goes at once. In-app alerts are not affected.
12. **Language:** messages in the owner's chosen language (English, Hindi or Hinglish). Each language is a separate template for Meta to approve, so English comes first and the others once approved. Hinglish is its own template name, filed under English.

## Build notes

13. **Alerts before their data exists:** P2.7 part 2 builds the alert machinery (alerts table, bell, settings, a test alert type). The low-stock rule lands with P1.8 or right after it merges; expiry with P1.10. The summary is built in P2.8 with pluggable sections; P1.14, P2.3, P1.18 and P1.10 each add their own line and its test.

## Details from the P2.7 design (2026-11-22)

14. **Staff who may not see stock** (`stock.view` off) get no stock alerts.
15. **Dismissing** hides an alert for that person until it clears; if the item runs low again later, the new alert shows again.
16. **Low and out of stock** for one item at one branch are one alert that changes between the two, never two at once.
17. **Items with no low-stock level** still get an out-of-stock alert when they reach 0.
18. **On the billing page** the bell shows its count like everywhere else and opens only when clicked.

## Open questions

None. To check in P2.8 (not owner decisions): the dashboard's temporary WhatsApp token likely expires after about 24 hours, so the worker needs a long-lived system user token; a template variable probably can't hold line breaks and a body is capped at 1,024 characters.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-19 — Finalized in fast-track sitting 2 (`docs/plans/2026-11-18-sitting-2.md`, items 2–6): the owner took every recommendation. WhatsApp question closed as already answered; bills and statements go through the outbox with a document template (option a).
- 2026-11-22 — P2.7 part 2 design answers: the owner took all 5 recommendations in `docs/plans/2026-11-22-p2.7-alerts-design.md` (section 9). Added #14–#18. #13's test alert type is replaced by low stock, which now has its data (P1.8). No decided point changed.
