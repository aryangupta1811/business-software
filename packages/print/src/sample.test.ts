import { BILL_DOCUMENTS } from '@business-software/shared';
import { describe, expect, it } from 'vitest';
import { sampleBill } from './sample.js';

describe('sampleBill', () => {
  it.each([
    ['regular', 'tax_invoice', 'cgst-sgst'],
    ['composition', 'bill_of_supply', 'none'],
    ['unregistered', 'bill', 'none'],
  ] as const)('a %s business gets a %s with %s tax', (scheme, document, tax) => {
    const bill = sampleBill({ scheme });
    expect(bill.document).toBe(document);
    expect(BILL_DOCUMENTS).toContain(bill.document);
    expect(bill.tax).toBe(tax);
  });

  it('charges tax on a regular bill and none on the others', () => {
    const regular = sampleBill();
    expect(regular.cgstPaise).toBeGreaterThan(0);
    expect(regular.sgstPaise).toBe(regular.cgstPaise);
    for (const scheme of ['composition', 'unregistered'] as const) {
      const bill = sampleBill({ scheme });
      expect(bill.cgstPaise + bill.sgstPaise + bill.igstPaise).toBe(0);
    }
  });

  it('charges IGST, not CGST and SGST, to a buyer in another state', () => {
    const bill = sampleBill({ interState: true });
    expect(bill.tax).toBe('igst');
    expect(bill.igstPaise).toBeGreaterThan(0);
    expect(bill.cgstPaise + bill.sgstPaise).toBe(0);
    expect(bill.placeOfSupplyStateCode).toBe('24');
    expect(bill.buyer?.gstin).toBe('24ABCDE1234F1Z5');
  });

  it('adds up: lines to totals, and payments to the grand total', () => {
    for (const bill of [
      sampleBill(),
      sampleBill({ interState: true }),
      sampleBill({ scheme: 'composition' }),
    ]) {
      expect(bill.lines.reduce((sum, line) => sum + line.taxablePaise, 0)).toBe(bill.taxablePaise);
      expect(bill.lines.reduce((sum, line) => sum + line.totalPaise, 0)).toBe(bill.totalPaise);
      expect(bill.totalPaise + bill.roundOffPaise).toBe(bill.grandTotalPaise);
      expect(bill.grandTotalPaise % 100).toBe(0);
      expect(bill.payments.reduce((sum, payment) => sum + payment.amountPaise, 0)).toBe(
        bill.grandTotalPaise,
      );
    }
  });

  it('gives the cash payment the change it needs, and no other payment any', () => {
    const bill = sampleBill();
    const [cash, upi] = bill.payments;
    expect(cash?.tenderedPaise).toBe((cash?.amountPaise ?? 0) + bill.changePaise);
    expect(upi?.tenderedPaise).toBeNull();
  });

  it('has a long English name, a name with Hindi, and a name without', () => {
    const [rice, notebook, biscuits] = sampleBill().lines;
    expect(rice?.itemHindiName).not.toBeNull();
    expect((notebook?.itemName.length ?? 0) > 40).toBe(true);
    expect(biscuits?.itemHindiName).toBeNull();
  });

  it('has no GSTIN when the shop is not registered, and passes the language on', () => {
    expect(sampleBill({ scheme: 'unregistered' }).seller.gstin).toBeNull();
    expect(sampleBill().seller.gstin).not.toBeNull();
    expect(sampleBill({ language: 'hi' }).language).toBe('hi');
    expect(sampleBill().language).toBe('en');
  });

  it('numbers its lines from 1', () => {
    expect(sampleBill().lines.map((line) => line.lineNo)).toEqual([1, 2, 3]);
  });
});
