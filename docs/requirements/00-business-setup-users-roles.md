# Module 00 — Business setup, users & roles

**Status:** DECIDED (29 Oct 2026)
**Decided:** business-type presets at signup, Owner + Staff roles with per-person permissions, and multiple branches from v1.

## Business types & customisation

1. At signup the owner picks a business type. It switches on a preset of features, item fields, dashboard widgets and default alerts.
2. It is one app with switches, not a separate app per type.
3. The owner can change the business type, or switch any feature on or off, later in settings. This matters for mixed shops (e.g. kirana + stationery).
4. No starter categories are pre-loaded. Owners add their own.
5. v1 supports 5 business types. More will be added later.

| Business type (v1) | Turned on by default |
| --- | --- |
| Kirana / grocery | Loose items sold by weight (kg/gram), expiry dates, udhaar shown prominently |
| Medical | Batch number and expiry required, MRP, expiry alerts |
| Clothing / footwear | Size and colour variants, exchanges, barcode label printing |
| Electronics / mobile | IMEI / serial number per unit, warranty tracking, repairs billed as a service |
| Hardware | Multiple units (bags, pieces, feet), wholesale vs retail price, large credit customers |

## GST setup

6. Signup asks for GST status. It decides what kind of bill the business issues:

| GST status | Bill issued |
| --- | --- |
| Not registered | Plain bill, no GST |
| Regular | Tax invoice with CGST + SGST (same state) or IGST (other state) |
| Composition scheme | Bill of supply, no tax shown separately |

## Business details

7. **Asked at signup** (kept short so signup is quick): business name, business type, phone, state, GST status.
8. **Filled later in settings:** owner name, email, address, PIN code, logo, GSTIN, PAN (optional), drug licence number (medical), FSSAI number (kirana / food), invoice number format (e.g. `ABC/2026-27/001`, restarting every April), terms & conditions footer, signature.
9. **Not included:** bank name, account number, IFSC and UPI ID. Shop owners keep their own payment QR separately.
10. The owner can edit these details later in settings, where a change is needed.
11. *Proposed by Claude, owner did not object:* bills already issued keep the details they were printed with. Editing the address later must not change old GST bills.

## Branches

12. One owner can run multiple branches, each with its own stock.
13. The dashboard can combine all branches.
14. Each branch has its own name and address. A branch in another state needs its own GSTIN.

## Users, roles & access

15. Default roles: **Owner** and **Staff**.
16. By default staff cannot see staff salaries or profit numbers (owner's original brief).
17. The owner can switch **any feature on or off for each staff login**. Changing permissions requires the owner's password.
18. The shop uses **one shared counter computer**. The owner decides which staff get access, and creates a username and password only for them.
19. Staff without a login still exist in the system, for attendance and salary.
20. Every action is recorded against the person logged in (this is what makes the entry log trustworthy).
21. The owner's session **locks automatically** after a few minutes of inactivity. Unlocking needs the password. Reason: staff share the computer and must not see owner-only data if the owner walks away.
22. Several counters can bill at the same time.
23. No phone use. The app is used on computers only.
24. No super-admin panel in v1.

## Language & notifications

25. The app runs in **English and Hindi**. Whether bills also print in Hindi is decided in Module 02.
26. Owner alerts are sent on **WhatsApp**. Details are decided in Module 07.

## Open questions

Not decided. Raised by Claude while importing.

- Exact auto-lock time ("a few minutes" — 2? 5? owner-configurable?).
- Can one staff member work in more than one branch?
- When a staff member leaves, their login is deactivated, never deleted (zero data loss). Confirm.
- How does the owner reset a forgotten password, given there is no phone app (email OTP, SMS OTP)?

## Change log

- 2026-10-29 — Created from the planning chat on claude.ai.
