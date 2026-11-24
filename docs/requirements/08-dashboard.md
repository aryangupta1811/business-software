# Module 08 — Dashboard

**Status:** DECIDED (24 Nov 2026)
**Decided:** a live home page with fixed widgets per business type; the owner sees all branches combined, staff see their own work and their branch's stock.

## Owner's brief

"A business dashboard showing the main highlights, like total revenue and today's present employees. Think of more features we can add to this dashboard."

## Already decided elsewhere

- The dashboard can combine all branches → `00` #13
- Widgets follow the business-type preset → `00` #1
- Profit and salaries are hidden from staff by default → `00` #16; per-person switches → `00` #17
- "Collected this week" and "who owes the most" → `03` #13
- Entry-log flags on the dashboard → `06` #8
- Cost and GST for composition and unregistered businesses → `04` #13

## Dates and branches

1. **Ranges:** today (default), yesterday, this week (starts Monday), this month, last month, custom. They change sales, profit, payments and top items. Stock, udhaar, attendance and salary widgets always show "now", except "collected this week".
2. **Comparisons** use the same days of the earlier period (1–20 November against 1–20 October; up to its last day if the earlier month is shorter). Today is compared with yesterday **up to the same time**. A custom range is compared with the same number of days just before it.
3. **Days follow Indian time** (the business date).
4. **Branches:** the owner sees all branches combined, with a switcher to one. Staff see only the branch they're logged into. A one-branch shop has no switcher.

## The owner's widgets

5. **In v1:** net sales; gross profit; payments by mode, sales and udhaar collections apart; udhaar due and overdue; udhaar collected this week; present / absent / on leave; low stock; top-selling items (by money, with a switch to quantity); pending salaries and advances.
6. **Net sales:** cancelled bills left out, credit notes taken off, counted on the day the credit note is made. Each total says whether it includes GST.
7. **Gross profit** (owner only): sales without GST minus the cost of what was sold, at each bill's own saved cost. Other expenses aren't included, and the label says so. A composition or unregistered business uses the full price minus its cost with GST.
8. **Unknown cost:** items sold with no known cost are left out of profit, and the widget says so ("₹3,200 of sales not counted, cost not set").
9. **Pending salary** is a finished month's salary not fully paid; advances show what is still to recover.

## Staff

10. **Staff see, by default:** their own bills and sales today, held bills at the branch, low stock at the branch, their own attendance this month. No shop totals, profit, udhaar totals, salaries, dues or flags unless the owner switches that on for the person.
11. **A widget never shows more than the pages behind it:** own sales need the sell permission, low stock needs the stock permission, and "See everyone's attendance" adds the attendance widget.

## How it behaves

12. **Hide and show** per widget, for the owner's own dashboard, saved per person. The order is fixed by the business type; no drag-and-drop.
13. **Live:** worked out when it opens and refreshed every 60 seconds, no summary tables. Target: under 0.5 s on the demo shop.
14. **Every number opens its list**, where that page exists.
15. **Empty states:** a new shop sees "No sales yet today" and a link to Billing, not zeros.
16. **The dashboard is the home page** (`Alt+H`). A widget that fails shows its own error and a retry; the others keep working.

## v1 delivery (the owner's portfolio cut, 2026-11-22)

- **In v1 (P2.9, P2.10):** everything above.
- **Waiting in `ideas-backlog.md`:** "expiring soon" (P1.10), flagged activity (P2.6), supplier dues (P2.2). They don't appear until then, not even as empty boxes.

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-24 — Finalized in fast-track sitting 3 (`docs/plans/2026-11-20-sitting-3.md`, items 6–10): the owner took every recommendation, including those added at the sitting: today against yesterday to the same time and custom-range comparison (#2), credit notes on their own day (#6), unknown costs (#8), what pending means (#9), widgets bounded by their pages (#11).
