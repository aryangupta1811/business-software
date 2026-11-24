// A made-up bill for the Settings "test print" and the tests. Its numbers come from the same
// engine that prices real bills, so the printed sums add up exactly as a saved bill's do.
import {
  calculateBill,
  type BillDetailView,
  type BillLanguage,
  type BillLineInput,
  type TaxScheme,
} from '@business-software/shared';

export interface SampleOptions {
  scheme?: TaxScheme;
  /** Sold to a buyer in Gujarat (GSTIN 24...), so IGST applies. Only a regular business can. */
  interState?: boolean;
  language?: BillLanguage;
}

const GOODS = [
  {
    itemName: 'Basmati rice',
    itemHindiName: 'बासमती चावल',
    unit: 'kg',
    hsn: '1006',
    rateBasisPoints: 500,
    unitPricePaise: 11_000,
    quantityThousandths: 2_500,
    priceIncludesTax: true,
  },
  {
    itemName: 'Notebook, long ruled, 172 pages, spiral bound, blue cover',
    itemHindiName: 'नोटबुक, लंबी लाइन, 172 पन्ने',
    unit: 'piece',
    hsn: '4820',
    rateBasisPoints: 1200,
    unitPricePaise: 4_500,
    quantityThousandths: 3_000,
    priceIncludesTax: false,
  },
  {
    itemName: 'Glucose biscuits',
    itemHindiName: null,
    unit: 'pack',
    hsn: '1905',
    rateBasisPoints: 1800,
    unitPricePaise: 1_000,
    quantityThousandths: 4_000,
    priceIncludesTax: true,
  },
] as const;

/** Three goods at 5%, 12% and 18%, paid part in cash and part by UPI. */
export function sampleBill(options: SampleOptions = {}): BillDetailView {
  const { scheme = 'regular', interState = false, language = 'en' } = options;
  const buyerStateCode = interState ? '24' : null;
  const priced = calculateBill({
    scheme,
    supplierStateCode: '27',
    placeOfSupplyStateCode: buyerStateCode ?? '27',
    lines: GOODS.map((item): BillLineInput => ({
      unitPricePaise: item.unitPricePaise,
      quantityThousandths: item.quantityThousandths,
      rateBasisPoints: item.rateBasisPoints,
      priceIncludesTax: item.priceIncludesTax,
      hsn: item.hsn,
    })),
  });
  const cash = Math.floor(priced.grandTotalPaise / 2 / 100) * 100;
  return {
    id: '0190f0f0-0000-7000-8000-0000000000a1',
    number: scheme === 'regular' ? 'ST/26-27/101' : 'ST/26-27/102',
    document:
      scheme === 'regular' ? 'tax_invoice' : scheme === 'composition' ? 'bill_of_supply' : 'bill',
    businessDate: '2026-11-23',
    createdAt: '2026-11-23T08:35:00.000Z',
    cashierName: 'Counter 1',
    seller: {
      businessName: 'Sample Store',
      branchName: 'Main shop',
      address: '12 Market Road, Shivajinagar, Pune',
      pinCode: '411005',
      stateCode: '27',
      gstin: scheme === 'unregistered' ? null : '27ABCDE1234F1Z5',
      drugLicence: null,
      fssai: null,
      phone: '9876543210',
    },
    buyer: interState
      ? {
          name: 'Patel Traders',
          gstin: '24ABCDE1234F1Z5',
          legalName: 'Patel Traders Private Limited',
          address: '5 Ring Road, Surat',
          pinCode: '395002',
          stateCode: '24',
        }
      : null,
    customerPhone: null,
    tax: priced.tax,
    supplierStateCode: '27',
    placeOfSupplyStateCode: buyerStateCode ?? '27',
    lines: priced.lines.map((line, index) => {
      const item = GOODS[index];
      if (item === undefined) throw new Error('A sample line without goods');
      return {
        lineNo: index + 1,
        itemName: item.itemName,
        itemHindiName: item.itemHindiName,
        unit: item.unit,
        quantityThousandths: item.quantityThousandths,
        unitPricePaise: item.unitPricePaise,
        priceIncludesTax: item.priceIncludesTax,
        ...line,
      };
    }),
    payments: [
      { mode: 'cash', amountPaise: cash, tenderedPaise: cash + 5_000, reference: null },
      {
        mode: 'upi',
        amountPaise: priced.grandTotalPaise - cash,
        tenderedPaise: null,
        reference: null,
      },
    ],
    grossPaise: priced.grossPaise,
    subtotalPaise: priced.subtotalPaise,
    billDiscountPaise: priced.billDiscountPaise,
    taxablePaise: priced.taxablePaise,
    cgstPaise: priced.cgstPaise,
    sgstPaise: priced.sgstPaise,
    igstPaise: priced.igstPaise,
    totalPaise: priced.totalPaise,
    roundOffPaise: priced.roundOffPaise,
    grandTotalPaise: priced.grandTotalPaise,
    changePaise: 5_000,
    language,
    footerNote: 'Goods once sold will not be taken back.',
  };
}
