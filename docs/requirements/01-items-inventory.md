# Module 01 — Items & inventory

**Status:** DECIDED (29 Oct 2026)
**Decided:** every item tracks units, prices, GST and stock; stock (and the low-stock level) is kept per branch, while the catalogue and its prices are one list for the whole business. Stock only changes through recorded actions.

## Item basics

1. **Item fields:** name, optional Hindi name, category, brand, unit, purchase price, selling price, MRP, GST rate, HSN code, barcode, low-stock level per branch. Purchase price is hidden from staff unless the owner allows it.
2. **Units:** buy in one unit and sell in another (a box of 12 bought, single pieces sold). Loose items sold by weight (250 g sold from a 50 kg bag).
3. **Prices:** retail and wholesale. A packaged item can never be sold above its MRP (illegal in India).

## Cost and profit

4. **Cost used for profit:** average cost for most businesses. For medical, cost is batch-wise: the purchase price of the batch actually sold (#15; was "oldest stock first" until 17 Nov 2026).

## Specific to business type

5. **Batch & expiry** (medical, kirana): billing automatically picks the batch expiring soonest. Expired stock cannot be sold.
6. **Variants** (clothing): each size and colour combination has its own stock and barcode. Same price for all variants by default, changeable per variant.
7. **Serial / IMEI** (electronics): each unit tracked individually, IMEI shown on the bill, warranty end date stored so it can be checked later.

## Getting stock in and keeping it accurate

8. **Barcodes:** scan the manufacturer's barcode, or print own labels for loose and unbranded items.
9. **Opening stock:** import from Excel, plus adding items manually.
10. **Stock increases:** after opening stock, stock goes up only through purchase entries (Module 04), never by editing the number directly.
11. **Stock adjustments:** for damage, theft, expiry or counting mismatch. Reason required, recorded in the entry log, allowed only for staff with permission.
12. **Negative stock:** if the system shows 0 but the item is on the shelf (purchase not entered yet), billing is allowed with a warning. The owner can switch this to block.
13. **Branch transfers:** move stock from one branch to another, recorded on both sides. **Shown only to businesses that have branches** (owner's change to Claude's recommendation).
14. **Physical stock count:** count stock by hand now and then; the app shows the difference and corrects it with a logged adjustment.

## Answered open questions (owner, 17 Nov 2026)

15. **Medical costing:** profit uses the purchase price of the batch actually sold on the bill. (This replaces "oldest stock first" in #4 for medical, because billing sells the batch expiring soonest, #5.)
16. **Units:** built in are kg, g, litre, ml, piece, box, dozen, pack, bag, metre, foot and pair. Owners can add their own unit with a conversion to a base unit (e.g. 1 crate = 24 pieces).
17. **Excel import errors:** nothing is saved until the owner confirms. A preview lists every error by row. The owner either fixes the file, or imports only the good rows and gets the bad rows back as an Excel file to fix.
18. **Inter-state branch transfers:** between branches with the same GSTIN, a transfer is a stock movement with a delivery challan. Between branches with different GSTINs (different states), the app makes an IGST tax invoice from the sending branch and a matching purchase entry at the receiving branch.

## v1 delivery (the owner's portfolio cut, 2026-11-22 (`docs/plans/2026-11-17-fast-track.md`, section 9))

The decided points stay decided; these wait in `ideas-backlog.md` ("Deferred from v1") and come back as whole tasks:

- **P1.10 (business-type stock features):** #5 batch and expiry, #6 variants, #7 serial / IMEI with warranty, #15 batch-wise medical costing, and printing own barcode labels (#8, second half). Until then every business type uses average cost (#4), and the feature switches show "Coming later" (`00` #62).
- **P1.9:** #17 Excel import of opening stock. Opening stock is entered per item (P1.8) until then.
- **P1.11:** #18 branch transfers and the physical stock count. Counting mismatches are corrected with stock adjustments (#11) until then.

## Open questions

None.

## Change log

- 2026-10-29 — Created from the planning chat on claude.ai.
- 2026-10-29 — Kickoff session: added the open question on inter-state branch transfers. No decided point changed.
- 2026-11-17 — Fast-track sitting 1: the owner answered all four open questions with Claude's recommendations (#15–18). #15 changes how #4 applies to medical shops: batch actually sold, not oldest stock first.
- 2026-11-19 — Fast-track sitting 2 (P1.7 design Q4): the owner confirmed one catalogue and one price list per business, with stock and the low-stock level per branch. The summary line was reworded to say so; it could be read as prices per branch. No numbered point changed.
- 2026-11-20 — Owner, P1.8 design (`docs/plans/2026-11-20-p1.8-stock-ledger-design.md`, section 12, all as recommended). No numbered point changed; details filled in: #12's warn/block is one switch for the whole business; an adjustment (#11) never takes stock below zero; #11's reasons are Damaged, Expired, Theft or lost, Own use and Other (with a note), all reducing stock, plus Count mismatch, the only one that can add stock; opening stock (#9) can be typed only while the item has no stock movements at that branch; #4's average cost is kept per item per branch; quantities are whole for piece, pair, dozen, box, pack and bag and allow 3 decimals for kg, g, litre, ml, metre and foot; an item with stock can be archived and keeps its stock and history.
- 2026-11-22 — Portfolio cut (owner): #5–7, #15, labels (#8), #17 and #18 deferred to the backlog with their tasks (P1.10, P1.9, P1.11). No decided point changed.
- 2026-11-24 — Sitting 3: what an item's cost includes is decided in `04` #13 (GST excluded for a regular business, included for composition and unregistered). No earlier point changed.
