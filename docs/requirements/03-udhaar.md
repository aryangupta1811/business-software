# Module 03 — Udhaar (customer credit)

**Status:** DECIDED (17 Nov 2026)
**Decided:** a running balance per named customer, payments that clear the oldest bills first, credit limits that warn (or block, if the owner chooses), and reminders the owner approves.

## Owner's brief

"In India people sometimes take goods and pay later. The shopkeeper has to take note of that, so that feature as well."

## Already decided elsewhere

- Udhaar is shown prominently for kirana; hardware has large credit customers → `00` business-type table
- The unpaid part of a bill goes to udhaar automatically; credit is a payment mode → `02` #10, #11
- Staff permissions are per-person feature switches → `00` #15–17
- WhatsApp goes through the outbox, with Meta's test number → ADR 0010
- What the shop owes its suppliers lives in Module 04

## The ledger

1. **Named customers only:** udhaar always needs a customer with a name and phone number.
2. **Running balance** per customer.
3. **Partial payments** against the balance, at any time.
4. **Payments clear the oldest bills first**, so overdue buckets stay right.
5. **Due dates:** 30 days by default, changeable per customer.
6. **Advance:** a customer who pays more than they owe shows an "advance" balance, used on their next bill.
7. **No interest or late fee in v1.** Overdue buckets still show who is late.

## Credit limits

8. **Credit limit** per customer.
9. **Over the limit:** a warning at billing by default. The owner can switch it to block, the same pattern as negative stock (`01` #12). When blocked, the owner's password lets one bill through, and the entry log records it.

## Who may do what

10. **Giving udhaar:** the owner always. Staff only when the owner switches "give udhaar" on for them, and never beyond a customer's credit limit.
11. **Recording payments:** all staff can. Each payment prints a receipt and goes into the entry log, so the owner sees who took the money.

## Seeing and collecting

12. **Overdue buckets:** 30 / 60 / 90+ days.
13. **Views:** "collected this week" and "who owes the most".
14. **Customer statement:** all bills and payments with the running balance, for any date range, as a PDF to print or send on WhatsApp.
15. **Reminders on WhatsApp:** the app prepares the list, and the owner reviews it and sends with one click. An optional weekly automatic send exists, off by default.

## v1 delivery (the owner's portfolio cut, 2026-11-22 (`docs/plans/2026-11-17-fast-track.md`, section 9))

16. **Reminders and statements on WhatsApp in v1** (owner, 2026-11-22, #14, #15): the reminder list works as decided (the app prepares it, the owner reviews it); each customer's "Send on WhatsApp" opens WhatsApp Web or Desktop with a click-to-chat link, the number and the reminder (name, balance, oldest due date) filled in, and the owner presses send there. A statement PDF is downloaded and attached by hand. The optional weekly automatic send (#15) waits for the WhatsApp Cloud API task (P2.8, `ideas-backlog.md`). ADR 0049.

## The P1.18 design (owner's answers, 2026-11-23; `docs/plans/2026-11-23-p1.18-udhaar-design.md` section 9)

17. **No credit limit set** means the owner can give any amount; staff need the owner's password for any udhaar to that customer.
18. **Staff over the limit:** the bill stops at "Needs the owner's OK", and the owner's password lets that one bill through, in warn and block mode alike (fills in #10).
19. **An advance** is used only when the cashier picks "From advance" as a payment row; it is never used automatically (fills in #6).
20. **Opening balance:** the owner enters the udhaar from the old notebook once per customer, with an "as of" date and a note; it is in the entry log. It can be entered at any time, also after the customer's first bill or payment, and always counts as the oldest entry, so payments clear it first (2026-11-24).
21. **A payment recorded by mistake** is reversed by the owner with a reason and their password: a reversing line, never an edit or a delete.
22. **A bill's due date** is fixed when the bill is saved (bill date + the customer's due days then); changing the due days later doesn't move old bills (fills in #5).
23. **Recording payments** needs "Sell at the counter" and no other switch (fills in #11).
24. **The credit limit and the due days** are changed only by the owner; staff with "Add and edit customers" see them but can't change them (a new customer added by staff has none set).

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-17 — Finalized with the owner in fast-track sitting 1. The owner confirmed every draft idea, chose Claude's recommendation on every question, and confirmed Claude's additions: #1 named customer, #4 oldest bills first, #5 30-day default, #6 advance balance.
- 2026-11-22 — Portfolio cut (owner): #16 click-to-chat for reminders and statements in v1; the weekly automatic send waits for P2.8 (ADR 0049).
- 2026-11-23 — P1.18 design answers (owner took every recommendation, `docs/plans/2026-11-23-p1.18-udhaar-design.md` §9): added #17–#23. They fill in #5, #6, #10 and #11; no earlier point changed.
- 2026-11-24 — Added #24 (owner): otherwise staff who also give udhaar could raise a limit and skip the owner's OK of #18.
- 2026-11-24 — #20: the opening balance can be entered at any time, once, and counts as the oldest entry (owner). The first build refused it after a customer's first entry, which could lock the owner out when a cashier gave udhaar first.
