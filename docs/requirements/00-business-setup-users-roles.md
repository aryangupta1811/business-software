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

36. **GST status and GSTIN agree** (sitting 2, G6): a GSTIN on a business whose status is "Not registered" is refused. A registered business (regular or composition) may sign up without a GSTIN, but needs one on its head office before its first tax invoice or bill of supply (`02` #25).

## Business details

7. **Asked at signup** (kept short so signup is quick): business name, business type, phone, state, GST status, owner's email, and the owner's password. Email is the owner's login (#27) and the way to reset a forgotten password (#30). The password has at least 10 characters, with no forced symbols, and can't be the email or the phone number; one box with a show/hide button.
8. **Filled later in settings:** owner name, address, PIN code, logo, GSTIN, PAN (optional), drug licence number (medical), FSSAI number (kirana / food), invoice number format (e.g. `ABC/2026-27/001`, restarting every April), terms & conditions footer, signature.
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
18. Each counter computer is **shared** by the owner and staff, and a shop can have more than one counter (#22). The owner decides which staff get access, and creates a username and password only for them.
19. Staff without a login still exist in the system, for attendance and salary.
20. Every action is recorded against the person logged in (this is what makes the entry log trustworthy).
21. The owner's session **locks automatically** after **5 minutes** of inactivity by default; the owner can set anything from 1 to 30 minutes in settings. Unlocking needs the password. Reason: staff share the computer and must not see owner-only data if the owner walks away.
22. Several counters can bill at the same time.
23. No phone use. The app is used on computers only.
24. No super-admin panel in v1.

## Logins, recovery & leaving

Numbered from 27 so earlier numbers keep their meaning.

27. **The owner logs in with email and password.** One email belongs to one owner account across the whole app.
28. **Staff log in with username and password.** A username only has to be unique within its business. After the owner logs in once on a counter computer, that computer remembers which business it belongs to, so staff type only their username and password.
29. A staff session doesn't lock like the owner's (#21). It **ends after 30 minutes of inactivity** by default, so a forgotten login isn't left open overnight. The owner can change the time in settings, from 5 to 120 minutes.
30. **Forgotten owner password:** the owner gets a reset link by email. This works only once the email is confirmed (#31).
31. **Recovery key:** at signup the owner is shown a recovery key to print or write down. It can also reset the password, as a backup when the email account is lost. *Proposed by Claude, owner did not object:* once used, it stops working and a new key is shown.
32. **Email confirmation** happens after signup, not during it, so signup stays quick. A banner asks the owner to confirm their email until they do. Until then, only the recovery key can reset the password.
33. **Forgotten staff password:** the owner sets a new one.
34. **When a staff member leaves**, their login is **deactivated, never deleted** (zero data loss, ADR 0007): they can't log in, their open sessions end at once, and everything they did stays in the records and the entry log. The owner can reactivate the login later.
35. **Staff and branches:** every staff member, with or without a login, has one **home branch**, where their attendance and salary are recorded. The owner can also let a staff login work in other branches.

Added 2026-11-19 from the P1.4 design answers (owner took every recommendation):

37. **Signup logs the owner in**, and that computer becomes the business's counter, so staff can log in on it (#28).
38. **The lock screen** (#21) shows a password box and a "Switch user" button. Unlocking returns to the same page with nothing lost. A staff login on a locked computer ends the owner's session. The owner can also lock at once with a "Lock now" button or `Alt+L`.
39. **Several counters at once:** the owner and each staff member may be logged in on more than one computer at the same time (#22); each computer has its own session.
40. **Closing Chrome logs the person out.** The computer still remembers its business (#28), so staff only type their username and password again.
41. **Failed logins:** after 10 wrong passwords for one login within 15 minutes, that login waits 15 minutes ("Try again at 14:35"); a computer gets 30 attempts in 15 minutes. The recovery key (#31) has its own limit and always gets the owner back in.
42. **Link lifetimes:** a password reset link works for 30 minutes, an email confirmation link for 7 days; each works once.
43. **Staff usernames:** 3 to 32 characters (letters, digits, dot, dash, underscore), not case-sensitive (`Ramesh` is `ramesh`), unique within the business only (#28).
44. **Remembered computers:** a computer stays remembered for 400 days (Chrome's longest), renewed at each owner login. Settings lists them with a Forget button, which needs the owner's password.
45. **Email in the demo** (no domain, D1): confirmation and reset emails reach only verified addresses; other visitors are told to use their recovery key (#31).
46. **Changing your own password** in Settings needs the current password and logs you out on every other computer. Changing the owner's email is not in v1.

## Language & notifications

25. The app runs in **English, Hindi and Hinglish** (Hindi words written in English letters, e.g. "Bill banao"), switchable at any time. Whether bills also print in Hindi is decided in Module 02.
26. Owner alerts are sent on **WhatsApp**. Details are decided in Module 07.

## Open questions

None. The five raised while importing were answered on 2026-11-02 (see the Change log).

## Change log

- 2026-10-29 — Created from the planning chat on claude.ai.
- 2026-10-29 — Kickoff session: added the open question on #18 vs #22. No decided point changed.
- 2026-10-30 — Owner (session 6, P0.5): #25 now includes Hinglish as a third interface language, next to English and Hindi.
- 2026-11-02 — Owner answered the open questions (session 15). Auto-lock: #21 now says 5 minutes by default, owner-settable from 1 to 30. Counters: #18 reworded (each counter is shared; a shop can have several). Password reset: by email link plus a printed recovery key (#30–#33). SMS OTP was rejected because of its per-message cost and DLT registration. **#7 changed:** the owner's email moved from settings (#8) to signup, which now has 6 fields. Deactivation confirmed (#34). Staff branches (#35). Two follow-ups Claude raised: login identifiers (#27, #28) and staff idle logout (#29).
- 2026-11-18 — Owner's answers for P1.3 (fast track Day 2). **#7 changed:** signup also asks for the owner's password (7 fields), at least 10 characters, no forced symbols, not the email or the phone number. Reason: email delivery is limited (D1, SES sandbox), so the owner needs a password from the start. **#29:** the staff idle time is settable from 5 to 120 minutes. Also settled, no decided line changed: address, PIN code, state, GSTIN, drug licence and FSSAI number are kept per branch (#8, #14); logo and signature arrive with printing (P1.15), the invoice number format with saving a bill (P1.14), the terms footer with printing (P1.15).
- 2026-11-19 — Fast-track sitting 2, G6: added #36, GST status and GSTIN must agree (a GSTIN on a not-registered business is refused; a registered one needs a GSTIN before its first tax invoice, checked at bill saving). No earlier point changed.
- 2026-11-19 — P1.4 design answers: the owner took all 11 recommendations in `docs/plans/2026-11-19-p1.4-login-design.md` (section 13). Added #37–#46 (signup logs in, lock screen, several counters, closing Chrome logs out, failed-login limits, link lifetimes, staff usernames, remembered computers, email in the demo, changing your own password). The staff password-reset and deactivate buttons come with P1.5's staff page; P1.4 builds the rules. No earlier point changed meaning.
