# Module 04 — Suppliers & purchases

**Status:** DECIDED (24 Nov 2026)
**Decided:** one purchase entry per supplier bill adds stock at its real cost; GST is stored as printed for the CA; entries are never edited, only cancelled; supplier balances, payments and returns come with P2.2.

## Why this module exists

Not in the owner's original brief. It became necessary once Module 01 decided that stock increases only through purchase entries.

## Already decided elsewhere

- After opening stock, stock goes up only through purchase entries → `01` #10
- Batch, expiry and IMEI are tracked per item where the business type needs them → `01` #5, #7
- Average cost; medical uses the batch's own cost → `01` #4, #15
- Negative stock warns, or blocks if the owner chooses → `01` #12
- Purchase price is hidden from staff unless the owner allows it → `01` #1
- Inter-state branch transfers make an IGST invoice and a matching purchase entry → `01` #18
- Payments split across modes → `02` #11; a saved bill is never edited → `02` #14
- Staff permissions are per-person switches → `00` #15–17

## Suppliers

1. **Supplier list:** name, phone, GSTIN (optional), state (from the GSTIN, or picked) and credit days (default 30, per supplier). Archived, never deleted. An opening balance for what the shop already owes comes with P2.2.
2. **No purchase orders.** The shop records the supplier's bill when the goods arrive.

## Purchase entries

3. **One entry is one supplier bill:** supplier, their bill number and date, lines (item, pack, quantity, free quantity, unit cost, discount, GST rate), other charges and total. Saving adds stock at each line's cost. Batch, expiry, MRP per batch and IMEI fields come with P1.10.
4. **Free goods and discounts:** a line has a free quantity and a discount. "10 + 1 free" adds 11 to stock, and the cost of 10 is spread over all 11.
5. **Other charges** (freight and similar) are one separate amount with its own GST, not added to item costs.
6. **Total check:** the typed bill total must match the lines and other charges within ₹1 of round-off, otherwise the entry isn't saved.
7. **The same bill twice is refused:** supplier + their bill number + financial year, ignoring cancelled entries. (Suppliers restart numbers every April, and a cancelled bill can be entered again.)
8. **Paying at entry:** paid now (cash, UPI, bank transfer, cheque), on credit, or split. A due date is fixed at saving: bill date + the supplier's credit days then.
9. **Last purchase price:** saving sets the item's purchase price to that line's unit cost, shown as "last purchase price". Profit still uses the average cost.
10. **MRP and selling price:** when a line's MRP differs from the item's, the entry offers to update MRP and selling price there. A warning shows when the cost is above the selling price. Only people who may edit items can update them.
11. **A saved entry is never edited.** A mistake is fixed by cancelling it with a reason: stock goes back out and the entry log records it. If some of the goods are already sold, the stock rule of `01` #12 decides: "warn" allows stock below zero with a warning, "block" refuses. Past bills' profit doesn't change.

## GST on purchases

12. **Stored as printed:** each line keeps its taxable value, rate and CGST + SGST or IGST, with the supplier's GSTIN, bill number and date. The CA export (`02` #18) gains a **purchase register** sheet, by bill and rate. No matching with the GST portal (GSTR-2B), no reverse charge.
13. **Cost and GST:** for a regular GST business an item's cost excludes GST. For a composition or unregistered business the cost **includes** GST, because it can't be claimed back. The register says so for a composition business.

## Who may do what

14. **Entering purchases:** the owner, and staff with the "Enter purchases" switch, off by default. They see the costs they type; other costs stay hidden without the purchase-price switch.
15. **Cancelling an entry:** the owner, and staff with the "Cancel purchases" switch, off by default.
16. **Paying suppliers** is its own switch, off by default (with P2.2).

## Supplier balances, payments and returns (P2.2)

17. **Balance** per supplier; payments (cash, UPI, bank transfer, cheque) clear the oldest bills first, as in `03` #4.
18. **Purchase returns** (debit notes) against an entry: stock goes out at that purchase's cost, and what the shop owes drops.
19. **Due alert:** "due in 3 days" (the 3 is settable) and "overdue", in the bell and the daily summary only (`07` #20).

## v1 delivery (the owner's portfolio cut, 2026-11-22)

- **In v1 (P2.1):** #1–#15 except where marked. The unpaid amount of each bill shows on the entry, but later payments can't be recorded, so the app shows no "supplier dues" until P2.2.
- **Waiting in `ideas-backlog.md`:** #16–#19 and the opening balance (P2.2); batch, expiry and IMEI (P1.10); the purchase side of inter-state transfers (P1.11); the daily summary line (P2.8).

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-24 — Finalized in fast-track sitting 3 (`docs/plans/2026-11-20-sitting-3.md`, items 1–5): the owner took every recommendation, including those added at the sitting: free goods and line discounts (#4), total check (#6), the financial year in the duplicate rule (#7), cancelling after some goods are sold (#11), cost including GST for composition and unregistered businesses (#13), the "Cancel purchases" switch (#15). Purchase orders and reading bills from a photo moved to the backlog.
