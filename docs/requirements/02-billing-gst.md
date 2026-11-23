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
20. **Compensation cess** (tobacco, aerated drinks, cars) is not in v1 (sitting 2, G2).

## Settled after finalizing (sitting 2, 2026-11-19)

21. **Checking GST rates:** an item's GST rate must be one of the current GST rates, and its HSN code must have a valid format. The app doesn't check that the HSN code carries that rate (that needs the full, changing HSN-to-rate table); the owner stays responsible for it. (G1)
22. **Exempt and 0% items** both show under rate 0 in the tax summary; split only if a CA asks. (G3)
23. **Round-off is always on** (#6); there is no setting to turn it off. (G4)
24. **HSN on every line** of a regular business's bill, stricter than the law for small shops' B2C bills; it comes from the item, so the cashier never types it. (G5)
25. **GSTIN before the first tax invoice:** a registered business (regular or composition) must have a GSTIN on the selling branch (for one branch, the head office) before saving its first tax invoice or bill of supply; checked when a bill is saved (P1.14), not at signup. See `00` #36. (G6)
26. **Rule 46's buyer details** (P1.14, owner 2026-11-22): on a tax invoice to a buyer without a GSTIN, name, address and state are required when the **taxable value** (before GST) is ₹50,000 or more, as CGST Rule 46(e) words it; the counter asks at the same number.

## v1 delivery (the owner's portfolio cut, 2026-11-22 (`docs/plans/2026-11-17-fast-track.md`, section 9))

- **#9 quotations** wait in `ideas-backlog.md` ("Deferred from v1"). P1.17 builds #18, the GST summary export.

27. **Sharing on WhatsApp in v1** (owner, 2026-11-22, #16): "Send on WhatsApp" opens WhatsApp Web or Desktop with a click-to-chat link, the customer's number and a short message filled in; the owner presses send there. The PDF is downloaded and attached by hand. Sending from the app through the WhatsApp Cloud API waits for P2.8 (backlog). ADR 0049.

## The P1.15 design (owner's answers, 2026-11-23; `docs/plans/2026-11-23-p1.15-printing-design.md` section 9)

28. **PDFs** are made by the worker with Chromium (its own image), as a queue job, and kept once made (ADR 0014).
29. **Receipt size (80 or 58 mm) and auto-print** are set per counter computer, not per business.
30. **Auto-print** is on by default: the receipt prints when the bill is saved; `P` reprints.
31. **A bill with the buyer's GSTIN** prints on A4 by default; `P` still gives the receipt (fills in #16).
32. **The Bills page:** staff with "Sell at the counter" see their branch's bills; the owner sees every branch's. Reprints are in the entry log.
33. **A reprint** says "Reprint" and its date under the title.
34. **The PDF's language** is always the business's bill language (#17).

## Open questions

None.

## Change log

- 2026-10-29 — Draft created from the planning chat on claude.ai.
- 2026-11-17 — Finalized with the owner in fast-track sitting 1. The owner confirmed every draft idea, chose Claude's recommendation on every question, and confirmed Claude's additions: #2 GSTIN check and optional B2C details, #3 place of supply, #5 per-item and per-bill discounts with GST after discount, #6 round-off line, #14 never edited.
- 2026-11-18 — #5: a bill discount in rupees means the customer pays exactly ₹X less (owner, 2026-11-18, while reviewing the P1.12 GST engine). Added to #5's text.
- 2026-11-19 — Fast-track sitting 2, GST questions G1–G6: the owner took every recommendation, G1 in the version revised by the P1.7 design (rate and HSN format checked, not the HSN-to-rate match). Added #20–25. No earlier point changed.
- 2026-11-21 — The owner answered the P1.13 design's 12 questions (`docs/plans/2026-11-20-p1.13-billing-design.md` §16), taking every recommendation: the billing key table; the same item scanned again adds to its line; no typed prices (a lower price is a discount); the staff limit applies per line and to the bill total; the owner's OK is given with the discount and lasts 30 minutes for that bill; held bills on the server per branch; discarding an unsaved bill is logged; an unknown code offers a quick "Add item"; a B2B buyer from another state gets IGST by default with a "delivered at the counter" switch; wholesale is one switch per bill; no scale barcodes in v1; 1.5% joins the GST rates. They fill in #5, #8, #11 and #12; no earlier point changed.
- 2026-11-22 — P1.14 design answers (`docs/plans/2026-11-22-p1.14-save-bill-design.md` §9). **#25 changed:** the GSTIN checked before a tax invoice is the selling branch's, the one printed on the bill (ADR 0045); for a one-branch business that is still the head office. Added #26 (Rule 46's ₹50,000 is the taxable value).
- 2026-11-22 — Portfolio cut (owner): #9 quotations deferred; #27 WhatsApp sharing by click-to-chat link in v1 (ADR 0049).
- 2026-11-23 — P1.15 design answers (owner took every recommendation, `docs/plans/2026-11-23-p1.15-printing-design.md` §9): added #28–#34. They fill in #16 and #17; no earlier point changed.
