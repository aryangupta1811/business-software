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

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-17 — Finalized with the owner in fast-track sitting 1. The owner confirmed every draft idea, chose Claude's recommendation on every question, and confirmed Claude's additions: #1 named customer, #4 oldest bills first, #5 30-day default, #6 advance balance.
