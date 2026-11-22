# Module 05 — Staff, attendance & salary

**Status:** DECIDED (19 Nov 2026)
**Decided:** one daily attendance register marked by the owner (or a trusted staff member), monthly and daily-wage salaries worked out from it, advances with a capped monthly recovery, and PDF salary slips.

## Owner's brief

"Staff attendance log, with staff salary slip. Sometimes staff take some advance; we should have a feature to load the advance amount so that it recalculates how much money to return."

The AI example "How many holidays has Rahul taken this month so far?" depends on this module.

## Already decided elsewhere

- Staff without a login still exist for attendance and salary → `00` #19
- Staff can't see salaries or profit by default → `00` #16
- The owner switches features on/off per staff login → `00` #17
- Deactivated, never deleted → `00` #34
- One home branch per staff member, where attendance and salary are recorded; the owner can let a login work in other branches → `00` #35
- Money in paise, exact → ADR 0008; round-off line like bills → `02` #6

## Staff records

1. **Fields:** name, phone, home branch, joining date, salary type and amount, weekly off day, paid leaves per month, overtime rate if any.
2. **Salary types:** monthly and daily wage. (Commission is in `ideas-backlog.md`.)
3. **Salary changes** start from the 1st of a month; old rates are kept, never overwritten, so old slips stay right.
4. **Leaving:** deactivating a person offers a final settlement slip: pay up to the last day, minus any advance left. An advance still left stays visible until settled (paid back, or written off by the owner with a reason).

## Attendance

5. **Who marks it:** the owner, or a staff member the owner switches "mark attendance" on for, on one daily register screen for the whole branch. Everyone starts as present; tap to change. Staff don't mark their own.
6. **One status per person per day:** present, half-day, absent, paid leave, weekly off, shop holiday. A present day can also carry **late** (yes/no) and **overtime hours**.
7. **Leave and holidays:** paid leaves per month per person (owner sets; default 0; unused ones don't carry over); a weekly off day per person; shop holidays on a calendar.
8. **Changing a past day** needs a reason and goes in the entry log.
9. **Other branches:** a day worked at another branch is marked present in the home branch's register.

## Pay

10. **Salary month:** the calendar month, paid after it ends. Joining or leaving mid-month pays only the days between.
11. **Monthly salary:** one day's pay = monthly salary ÷ the days in that month (28 to 31). Weekly offs, shop holidays and paid leaves are paid. An absent day takes off one day's pay, a half-day half of it. Leave beyond the month's paid-leave quota counts as absent.
12. **Daily wage:** paid for each present day; a half-day pays half. Weekly offs and holidays are unpaid.
13. **Working on a weekly off or holiday** pays one extra day's pay (monthly) or the normal day's wage (daily).
14. **Late:** recorded and shown on the slip, no automatic pay cut. The owner can add a deduction with a reason.
15. **Overtime:** off by default; the owner switches it on per person with a rate in ₹ per hour.
16. **Bonus and fines:** one-off additions and deductions on a month, each with a reason.
17. **Rounding:** worked out exactly in paise; net pay rounded to the nearest rupee with a round-off line.
18. **Labour law:** the app records the owner's choices and doesn't enforce labour law. It can warn (for example, deductions above half the month's pay); it doesn't block.
19. **A finalized month is locked:** its attendance can't change; a correction becomes an addition or deduction on the next month, with a reason.

## Advances

20. **Allowed above a month's salary.** Each person has one running advance balance (advances add, recoveries reduce), no interest.
21. **Recovery:** the owner sets an amount per month, or "all at once", and can change it at any time. A month's recovery is capped at 50% of that month's pay by default (owner can change the cap) and never takes the pay below zero; whatever doesn't fit carries to the next month by itself.
22. **The slip** shows what was deducted this month and what is still left to return.

## Paying and slips

23. **Salary payment:** cash or UPI, full or partial. A partial payment leaves "salary still due" on the person's balance.
24. **Salary slip:** A4 PDF (ADR 0014), in the bill language setting (`02` #17).

## Who may do what

25. **Staff see only their own** attendance and slip by default. Seeing other people's attendance, and other people's salaries and slips, are feature switches that start off (`00` #16, #17).
26. **Feature switches that start off for staff:** setting salaries, giving advances, paying salaries, marking attendance.
27. **Entry log:** marking or changing attendance, salary set or changed, advance given, recovery changed, salary paid, month finalized.

## For the AI assistant

28. **"Holidays taken"** counts absent days plus leave days; weekly offs and shop holidays are not "taken".

## Decided while designing P2.3 (2026-11-22)

29. **A day nobody marked** counts as its default: present, or the person's weekly off, or a shop holiday. Only the marks people make are stored.
30. **A salary change** can start from the 1st of the current month or of any later month, not an earlier one.
31. **Shop holidays** are for every branch by default; the owner can pick one branch instead.
32. **The register** covers today and past days only; marking days ahead is not in v1.
33. **Adding someone** needs only name, home branch and joining date. Phone and salary can come later; "Salary not set" shows until then, and P2.4 doesn't pay without one.

## Open questions

None. Out of v1, in `ideas-backlog.md`: commission on sales; PF and ESI deductions. To check when building P2.4 (not owner decisions): the current Labour Codes' caps on deductions and fines, which the warning in #18 refers to.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-19 — Finalized in fast-track sitting 2 (`docs/plans/2026-11-18-sitting-2.md`, items 11–16): the owner took every recommendation. Commission on sales and PF/ESI moved to the ideas backlog; attendance states reshaped into one status per day plus late and overtime.
- 2026-11-22 — P2.3 design (`docs/plans/2026-11-22-p2.3-staff-attendance-design.md`): the owner took every recommendation; added #29–#33.
