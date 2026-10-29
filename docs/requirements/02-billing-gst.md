# Module 02 — Billing & GST

**Status:** DRAFT — ideas from the planning chat, mostly suggested by Claude. Nothing here is decided until `/finalize-module 02`.

## Owner's brief

"Billing system with GST number and all details."

## Already decided elsewhere

- Bill type depends on GST status: plain bill / tax invoice (CGST+SGST or IGST) / bill of supply → `00` #6
- Invoice number format, restarting every April → `00` #8
- Bills keep the business details they were printed with → `00` #11
- Packaged items can't be sold above MRP → `01` #3
- Billing picks the batch expiring soonest; expired stock can't be sold → `01` #5
- IMEI shown on the bill → `01` #7
- Negative stock: allowed with warning, owner can switch to block → `01` #12
- Fast billing with keyboard and barcode scanner; several counters at once → `product-overview.md`

## Draft ideas

- HSN code and GST rate per item, applied automatically.
- B2B bills with the customer's GSTIN, and simple B2C bills.
- Prices can be tax-inclusive or tax-exclusive.
- Discounts and round-off.
- Split or partial payment (e.g. part cash, part UPI). The unpaid part goes to udhaar automatically.
- Returns through credit notes. Bills are cancelled with a reason, never deleted.
- Quotations that convert into bills.
- GST summary export for the CA.
- Print on a receipt printer and/or A4; share the bill on WhatsApp.
- Capture customer name and phone at billing. Without them, the AI can't answer "who is our top customer" (Module 09).

## Questions to settle

- Do bills also print in Hindi? (from `00` #25)
- Which payment modes: cash, UPI, card, cheque, credit?
- Can staff give discounts? Up to what limit?
- Can staff cancel bills, or only the owner?
- Hold a bill and serve the next customer (several open bills at once)?
- E-invoicing and e-way bills: in scope or not?
- Receipt printer width (58 mm / 80 mm) and A4 — see open question 5 in `product-overview.md`.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
