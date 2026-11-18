# Module 02 — Billing & GST

**Status:** DECIDED (17 Nov 2026)
**Decided:** fast GST-correct bills (tax invoice, bill of supply or plain bill), every payment mode including split and udhaar, never edited or deleted, printed and shared in the business's chosen language.

## Owner's brief

"Billing system with GST number and all details."

## Already decided elsewhere

- Bill type depends on GST status: plain bill / tax invoice (CGST+SGST or IGST) / bill of supply → `00` #6
- Invoice number format, restarting every April → `00` #8
- Bills keep the business details they were printed with → `00` #11
- Packaged items can't be sold above MRP → `01` #3
- Billing picks the batch expiring soonest; expired stock can't be sold → `01` #5
- Profit uses the purchase price of the batch actually sold (medical) → `01` #15
- IMEI shown on the bill → `01` #7
- Negative stock: allowed with warning, owner can switch to block → `01` #12
- Fast billing with keyboard and barcode scanner; several counters at once → `product-overview.md`
- 80 mm receipt (58 mm as a setting) and A4, PDFs that show Hindi correctly → `product-overview.md` question 5, ADR 0014
- Udhaar given at billing, credit limits and who may give udhaar → `03`

## Making a bill

1. **GST from the item:** each item's HSN code and GST rate apply automatically.
2. **B2B and B2C:** a B2B tax invoice needs the customer's GSTIN, and the app checks its format. A B2C bill can be simple: customer name and phone are optional.
3. **Place of supply** decides the tax: same state → CGST + SGST; another state → IGST.
4. **Prices** can be tax-inclusive or tax-exclusive.
5. **Discounts** per item and on the whole bill. GST is worked out on the price after the discount. A bill discount in rupees means the customer pays exactly ₹X less.
6. **Round-off** to the nearest rupee, shown on its own line.
7. **Customer capture:** name and phone can be taken at billing (needed for udhaar, and for the assistant's "who is our top customer", Module 09).
8. **Hold a bill:** a counter can hold several open bills, serve the next customer and bring a held bill back. A held bill doesn't touch stock until it is saved.
9. **Quotations** can be made and later turned into a bill.

## Payment

10. **Payment modes:** cash, UPI, card, cheque, and credit (udhaar).
11. **Split payment:** one bill can be paid several ways (e.g. part cash, part UPI). Any unpaid part goes to the customer's udhaar balance (Module 03).

## Who may do what

12. **Staff discounts:** the owner switches discounts on per staff member and sets a maximum %. Going above it needs the owner's password at the counter. Every discount is recorded in the entry log.
13. **Cancelling a bill:** the owner by default; the owner can switch it on for a trusted staff member. A reason is always required, stock goes back, and the entry log records who and why.

## After the bill

14. **A saved bill is never edited and never deleted.** A mistake is fixed by cancelling the bill with a reason and billing again, or with a credit note.
15. **Returns** go through credit notes.
16. **Printing:** on the receipt printer and/or A4, and shared as a PDF on WhatsApp.
17. **Bill language:** a per-business setting, English, Hindi or Hinglish. Item names print in Hindi where the item has a Hindi name. GSTIN, HSN and tax figures always appear as the law requires.
18. **GST summary export** for the CA.

## Not in v1

19. **E-invoicing and e-way bills** are not built in v1 (e-invoicing is compulsory only above ₹5 crore turnover; e-way bills are for moving goods over ₹50,000). Bills store every field the government portals need (GSTIN, HSN, values), so they can be added later without changing data.

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-17 — Finalized with the owner in fast-track sitting 1. The owner confirmed every draft idea, chose Claude's recommendation on every question, and confirmed Claude's additions: #2 GSTIN check and optional B2C details, #3 place of supply, #5 per-item and per-bill discounts with GST after discount, #6 round-off line, #14 never edited.
- 2026-11-18 — #5: a bill discount in rupees means the customer pays exactly ₹X less (owner, 2026-11-18, while reviewing the P1.12 GST engine). Added to #5's text.
