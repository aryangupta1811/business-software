# Module 01 — Items & inventory

**Status:** DECIDED (29 Oct 2026)
**Decided:** every item tracks units, prices, GST and stock per branch, and stock only changes through recorded actions.

## Item basics

1. **Item fields:** name, optional Hindi name, category, brand, unit, purchase price, selling price, MRP, GST rate, HSN code, barcode, low-stock level per branch. Purchase price is hidden from staff unless the owner allows it.
2. **Units:** buy in one unit and sell in another (a box of 12 bought, single pieces sold). Loose items sold by weight (250 g sold from a 50 kg bag).
3. **Prices:** retail and wholesale. A packaged item can never be sold above its MRP (illegal in India).

## Cost and profit

4. **Cost used for profit:** average cost for most businesses. For medical, cost is batch-wise (oldest stock first).

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

## Open questions

Not decided. Raised by Claude while importing.

- **Medical costing vs billing order.** Decision 4 says oldest-stock-first costing; decision 5 says the batch expiring soonest is sold first. These can be different batches. Simplest consistent rule: profit uses the purchase price of the batch actually sold. Confirm.
- Which units come built in (kg, g, litre, ml, piece, box, dozen, bag, foot, metre)? Can owners add their own?
- Excel import: what happens to rows with errors (skip and report, or stop)?
- **Inter-state branch transfers (#13).** Under GST, branches with different GSTINs count as separate taxable persons, so moving stock to a branch in another state is a supply that needs a tax invoice (IGST), not just a stock movement. Within one GSTIN it is only a stock movement (with a delivery challan for transport). How should the app handle the inter-state case? (Raised in the kickoff session.)

## Change log

- 2026-10-29 — Created from the planning chat on claude.ai.
- 2026-10-29 — Kickoff session: added the open question on inter-state branch transfers. No decided point changed.
