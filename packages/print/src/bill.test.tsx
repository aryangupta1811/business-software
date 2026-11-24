import type { BillDetailView } from '@business-software/shared';
import { describe, expect, it } from 'vitest';
import { renderBill, taxByHsn, taxByRate } from './bill.js';
import { sampleBill } from './sample.js';

const regular = sampleBill();
const interState = sampleBill({ interState: true });
const composition = sampleBill({ scheme: 'composition' });
const plain = sampleBill({ scheme: 'unregistered' });
const gujaratBuyer = (() => {
  if (interState.buyer === null) throw new Error('The inter-state sample has a buyer');
  return interState.buyer;
})();

/** The visible text of some markup: tags dropped, entities left as they are. */
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('a tax invoice (a regular business)', () => {
  const html = renderBill(regular, { size: '80' });

  it('says what it is and carries the seller details the law asks for', () => {
    const words = text(html);
    expect(words).toContain('Tax Invoice');
    expect(words).toContain('Sample Store');
    expect(words).toContain('12 Market Road, Shivajinagar, Pune');
    expect(words).toContain('GSTIN: 27ABCDE1234F1Z5');
    expect(words).toContain('ST/26-27/101');
  });

  it('shows the date and the time as India reads them', () => {
    expect(text(html)).toContain('23-11-2026');
    expect(text(html)).toContain('2:05 PM');
  });

  it('shows the HSN of every line (02 #24)', () => {
    const words = text(html);
    for (const line of regular.lines) expect(words).toContain(`HSN ${line.hsn}`);
  });

  it('shows CGST and SGST, and no IGST, for a sale inside the state', () => {
    const words = text(html);
    expect(words).toContain('CGST 2.5%');
    expect(words).toContain('SGST 2.5%');
    expect(words).toContain('CGST 9%');
    expect(words).not.toContain('IGST');
    expect(words).not.toContain('Place of supply');
  });

  it('prints each line before tax and the totals that follow from them', () => {
    const words = text(html);
    expect(words).toContain('Taxable value');
    expect(words).toContain('Grand total');
    expect(words).toContain(
      `₹${(regular.grandTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    );
  });
});

describe('a tax invoice to a buyer in another state', () => {
  const words = text(renderBill(interState, { size: '80' }));

  it('shows IGST and no CGST or SGST', () => {
    expect(words).toContain('IGST 12%');
    expect(words).not.toContain('CGST');
    expect(words).not.toContain('SGST');
  });

  it('names the place of supply and the buyer with their GSTIN', () => {
    expect(words).toContain('Place of supply');
    expect(words).toContain('Gujarat (24)');
    expect(words).toContain('Patel Traders');
    expect(words).toContain('GSTIN: 24ABCDE1234F1Z5');
  });
});

describe('a bill of supply (composition)', () => {
  const words = text(renderBill(composition, { size: '80' }));

  it('says so, with the seller GSTIN, and shows no tax at all', () => {
    expect(words).toContain('Bill of Supply');
    expect(words).toContain('GSTIN: 27ABCDE1234F1Z5');
    for (const tax of ['CGST', 'SGST', 'IGST', 'Taxable value', 'Total tax']) {
      expect(words).not.toContain(tax);
    }
  });

  it('keeps the HSN a composition item carries: the requirements ask for it only on a regular bill, and do not forbid it here', () => {
    expect(words).toContain('HSN 1006');
  });
});

describe('a plain bill (an unregistered shop)', () => {
  const words = text(renderBill(plain, { size: '80' }));

  it('is only called a bill and shows no GSTIN, HSN or tax', () => {
    expect(words).toContain('Bill');
    expect(words).not.toContain('Tax Invoice');
    expect(words).not.toContain('Bill of Supply');
    for (const absent of ['GSTIN', 'HSN', 'CGST', 'SGST', 'IGST', 'Taxable value']) {
      expect(words).not.toContain(absent);
    }
  });

  it('shows no GSTIN even if the saved seller has one', () => {
    const odd: BillDetailView = {
      ...plain,
      seller: { ...plain.seller, gstin: '27ABCDE1234F1Z5' },
    };
    expect(text(renderBill(odd, { size: 'a4' }))).not.toContain('27ABCDE1234F1Z5');
  });

  it('shows no HSN even if the lines carry one', () => {
    expect(text(renderBill(plain, { size: 'a4' }))).not.toContain('HSN');
  });
});

describe('the tax table', () => {
  it.each([
    ['inside the state', regular],
    ['to another state', interState],
  ])('adds up to the bill’s own totals, %s', (_name, bill) => {
    const rows = taxByRate(bill.lines);
    const sum = (key: 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise') =>
      rows.reduce((total, row) => total + row[key], 0);
    expect(sum('taxablePaise')).toBe(bill.taxablePaise);
    expect(sum('cgstPaise')).toBe(bill.cgstPaise);
    expect(sum('sgstPaise')).toBe(bill.sgstPaise);
    expect(sum('igstPaise')).toBe(bill.igstPaise);
    expect(sum('totalPaise')).toBe(bill.totalPaise);
  });

  it('has one row per rate, lowest first', () => {
    expect(taxByRate(regular.lines).map((row) => row.rateBasisPoints)).toEqual([500, 1200, 1800]);
  });

  it('keeps two codes at one rate apart in the HSN table, and adds up too', () => {
    const [first, second, third] = regular.lines;
    if (first === undefined || second === undefined || third === undefined) throw new Error();
    const lines = [first, { ...second, rateBasisPoints: 500 }, { ...third, hsn: first.hsn }];
    expect(taxByRate(lines).map((row) => row.rateBasisPoints)).toEqual([500, 1800]);
    expect(taxByHsn(lines).length).toBe(3);
    expect(taxByHsn(regular.lines).reduce((sum, row) => sum + row.taxablePaise, 0)).toBe(
      regular.taxablePaise,
    );
  });
});

describe('the bill language', () => {
  const hindi = sampleBill({ language: 'hi' });

  it('prints the Hindi name of an item that has one, and only that', () => {
    const words = text(renderBill(hindi, { size: '80' }));
    expect(words).toContain('बासमती चावल');
    expect(words).not.toContain('Basmati rice');
  });

  it('falls back to the English name for an item with no Hindi name', () => {
    expect(text(renderBill(hindi, { size: '80' }))).toContain('Glucose biscuits');
  });

  it.each(['en', 'hi-Latn'] as const)('prints English item names in %s', (language) => {
    const words = text(renderBill(sampleBill({ language }), { size: '80' }));
    expect(words).toContain('Basmati rice');
    expect(words).not.toContain('बासमती चावल');
  });

  it('writes the labels in Hindi but keeps GSTIN, HSN, the tax names and the digits Latin', () => {
    const words = text(renderBill(hindi, { size: 'a4' }));
    expect(words).toContain('टैक्स इनवॉइस');
    expect(words).toContain('GSTIN: 27ABCDE1234F1Z5');
    expect(words).toContain('HSN');
    expect(words).toContain('CGST');
    expect(words).toContain('ST/26-27/101');
    expect(words).not.toMatch(/[०-९]/);
  });

  it('writes the labels in Hinglish', () => {
    const words = text(renderBill(sampleBill({ language: 'hi-Latn' }), { size: 'a4' }));
    expect(words).toContain('Tareekh');
    expect(words).toContain('Shabdon mein rakam');
  });

  it('writes the amount in words in the bill language', () => {
    expect(text(renderBill(regular, { size: 'a4' }))).toContain('Rupees');
    expect(text(renderBill(hindi, { size: 'a4' }))).toContain('रुपये');
  });
});

describe('what the shop typed is escaped', () => {
  const evil = '<script>alert(1)</script>';

  it.each(
    (['80', '58', 'a4'] as const).flatMap((size) =>
      (['en', 'hi'] as const).map((language) => [size, language] as const),
    ),
  )('in every place it appears, at size %s in %s', (size, language) => {
    const [first, ...others] = regular.lines;
    if (first === undefined) throw new Error('no lines');
    const bill: BillDetailView = {
      ...regular,
      language,
      seller: { ...regular.seller, businessName: evil, address: evil },
      buyer: { ...gujaratBuyer, name: evil },
      lines: [{ ...first, itemName: evil, itemHindiName: evil, unit: evil }, ...others],
      payments: [
        {
          mode: 'cash',
          amountPaise: regular.grandTotalPaise,
          tenderedPaise: null,
          reference: evil,
        },
      ],
      footerNote: evil,
      cashierName: evil,
    };
    const html = renderBill(bill, { size });
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    // Every place the shop typed in: shop, address, buyer, item, payment reference, note, cashier.
    expect(html.split('&lt;script&gt;').length - 1).toBeGreaterThanOrEqual(7);
  });
});

describe('the markup carries no inline style (the page’s CSP refuses it)', () => {
  it.each(['80', '58', 'a4'] as const)('at size %s, for every kind of bill', (size) => {
    for (const bill of [regular, interState, composition, plain]) {
      const html = renderBill(bill, { size, reprintedAt: '2026-11-24T09:00:00.000Z' });
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toContain('<style');
    }
  });
});

describe('the sizes', () => {
  it.each([
    ['80', 's80'],
    ['58', 's58'],
    ['a4', 'a4'],
  ] as const)('puts size %s on the page as the class %s', (size, className) => {
    expect(renderBill(regular, { size })).toContain(`class="bill ${className} `);
  });

  it('writes the amount in words, the tax summary and the signature on A4 only', () => {
    const a4 = text(renderBill(regular, { size: 'a4' }));
    const receipt = text(renderBill(regular, { size: '80' }));
    for (const onlyA4 of ['Amount in words', 'Tax summary', 'Authorised signatory']) {
      expect(a4).toContain(onlyA4);
      expect(receipt).not.toContain(onlyA4);
    }
  });

  it('puts the items of an A4 invoice in a table with the tax in columns', () => {
    const html = renderBill(regular, { size: 'a4' });
    expect(html).toContain('<table');
    expect(text(html)).toContain('Taxable value');
  });

  it('leaves the tax summary and the amount in words off an A4 plain bill, but keeps the signature', () => {
    const a4 = text(renderBill(plain, { size: 'a4' }));
    expect(a4).not.toContain('Tax summary');
    expect(a4).toContain('Amount in words');
    expect(a4).toContain('Authorised signatory');
  });

  it('puts the long name of an item on a line of its own, so a narrow paper can wrap it', () => {
    expect(renderBill(regular, { size: '58' })).toContain(
      '<div class="name">Notebook, long ruled, 172 pages, spiral bound, blue cover</div>',
    );
  });
});

describe('a reprint (02 #33)', () => {
  it('says Reprint with its date under the title', () => {
    const words = text(
      renderBill(regular, { size: '80', reprintedAt: '2026-11-24T09:00:00.000Z' }),
    );
    expect(words).toMatch(/Tax Invoice Reprint 24-11-2026/);
  });

  it('says it in the bill language', () => {
    const words = text(
      renderBill(sampleBill({ language: 'hi' }), {
        size: 'a4',
        reprintedAt: '2026-11-24T09:00:00.000Z',
      }),
    );
    expect(words).toContain('दोबारा छपा');
  });

  it('says nothing of the sort on the first print', () => {
    expect(text(renderBill(regular, { size: '80' }))).not.toContain('Reprint');
    expect(text(renderBill(regular, { size: 'a4', reprintedAt: null }))).not.toContain('Reprint');
  });
});

describe('payments', () => {
  it('lists each way the bill was paid, and the change from the cash', () => {
    const words = text(renderBill(regular, { size: '80' }));
    expect(words).toContain('Cash');
    expect(words).toContain('UPI');
    expect(words).toContain('Cash given');
    expect(words).toContain('Change');
    expect(words).toContain('Change 50.00');
  });

  it('shows no change line when there is none', () => {
    const bill: BillDetailView = { ...regular, changePaise: 0 };
    expect(text(renderBill(bill, { size: '80' }))).not.toContain('Change');
  });

  it('prints a mode this version has no name for as it was stored, and its reference', () => {
    const bill: BillDetailView = {
      ...regular,
      changePaise: 0,
      payments: [
        {
          mode: 'udhaar' as 'cash',
          amountPaise: regular.grandTotalPaise,
          tenderedPaise: null,
          reference: 'UTR123',
        },
      ],
    };
    const words = text(renderBill(bill, { size: '80' }));
    expect(words).toContain('udhaar');
    expect(words).toContain('UTR123');
  });
});

describe('the rest of the header and the footer', () => {
  it('prints the shop phone, drug licence and FSSAI when they were saved', () => {
    const bill: BillDetailView = {
      ...regular,
      seller: { ...regular.seller, drugLicence: 'MH-PUN-123', fssai: '11223344556677' },
    };
    const words = text(renderBill(bill, { size: '80' }));
    expect(words).toContain('Phone: 9876543210');
    expect(words).toContain('Drug licence: MH-PUN-123');
    expect(words).toContain('FSSAI: 11223344556677');
  });

  it('prints a bill saved before shop phones were stored without one', () => {
    const seller = { ...regular.seller };
    delete seller.phone;
    const words = text(renderBill({ ...regular, seller }, { size: '80' }));
    expect(words).not.toContain('Phone');
  });

  it('prints the footer note, or nothing when there is none', () => {
    expect(text(renderBill(regular, { size: '80' }))).toContain(
      'Goods once sold will not be taken back.',
    );
    expect(text(renderBill({ ...regular, footerNote: null }, { size: '80' }))).not.toContain(
      'Goods once sold',
    );
  });

  it('prints a walk-in customer with no details as no buyer at all', () => {
    expect(text(renderBill(regular, { size: '80' }))).not.toContain('Billed to');
  });

  it('prints the buyer name, address and state when Rule 46 asked for them', () => {
    const buyer = { ...gujaratBuyer, gstin: null };
    const words = text(renderBill({ ...regular, buyer }, { size: 'a4' }));
    expect(words).toContain('Billed to');
    expect(words).toContain('Patel Traders');
    expect(words).toContain('5 Ring Road, Surat');
    expect(words).toContain('Gujarat (24)');
    expect(words).not.toContain('GSTIN: 24');
  });

  it('shows a discount line only when there was a discount', () => {
    expect(text(renderBill(regular, { size: '80' }))).not.toContain('Discount');
    const [first, ...others] = regular.lines;
    if (first === undefined) throw new Error('no lines');
    const bill: BillDetailView = {
      ...regular,
      lines: [{ ...first, discountOffTaxablePaise: 1_000 }, ...others],
    };
    expect(text(renderBill(bill, { size: '80' }))).toContain('Discount');
  });

  it('shows the round-off only when there is one', () => {
    expect(text(renderBill({ ...regular, roundOffPaise: 0 }, { size: '80' }))).not.toContain(
      'Round off',
    );
    expect(text(renderBill({ ...regular, roundOffPaise: -12 }, { size: '80' }))).toContain(
      'Round off',
    );
  });
});
