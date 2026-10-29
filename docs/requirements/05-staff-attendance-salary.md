# Module 05 — Staff, attendance & salary

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 05`.

## Owner's brief

"Staff attendance log, with staff salary slip. Sometimes staff take some advance; we should have a feature to load the advance amount so that it recalculates how much money to return."

The AI example "How many holidays has Rahul taken this month so far?" depends on this module.

## Already decided elsewhere

- Staff without a login still exist for attendance and salary → `00` #19
- Staff can't see salaries or profit by default → `00` #16
- The owner switches features on/off per staff login → `00` #17

## Draft ideas

- Attendance states: present, absent, half-day, leave, late, overtime.
- Salary types: monthly, daily wage, commission on sales.
- Advances: recovered all at once or in monthly instalments. The salary slip shows what was deducted this month and what is still left to return.
- Paid leave quota, weekly off, festival holidays, Diwali bonus, fines.
- Record of the actual salary payment: cash or UPI, full or partial.
- Staff with a login see only their own attendance and slip.
- Salary slip as print/PDF.

## Questions to settle

- **Who marks attendance — the owner, or staff themselves?** (A trust question.)
- How are half-days, late arrivals and overtime counted in pay?
- What if an advance is bigger than one month's salary?
- Can a staff member work in more than one branch? (also open in `00`)
- Statutory deductions (PF, ESI): in scope or not?

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
