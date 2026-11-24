// What a bill says, in each bill language (`02` #17). GSTIN, HSN, CGST, SGST and IGST are the
// names the law and the GST portal use, so they stay in Latin letters in every language.
import type { BillDocument, BillLanguage } from '@business-software/shared';

export interface Labels {
  documents: Record<BillDocument, string>;
  reprint: string;
  billNo: string;
  date: string;
  time: string;
  cashier: string;
  phone: string;
  drugLicence: string;
  fssai: string;
  billedTo: string;
  placeOfSupply: string;
  item: string;
  qty: string;
  rate: string;
  taxable: string;
  amount: string;
  inclusive: string;
  discount: string;
  subtotal: string;
  taxableValue: string;
  totalTax: string;
  taxSummary: string;
  roundOff: string;
  grandTotal: string;
  total: string;
  paidBy: string;
  cashGiven: string;
  change: string;
  amountInWords: string;
  signatory: string;
  forBusiness: string;
  payment: Record<string, string>;
  units: Record<string, string>;
}

const en: Labels = {
  documents: { tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', bill: 'Bill' },
  reprint: 'Reprint',
  billNo: 'Bill no.',
  date: 'Date',
  time: 'Time',
  cashier: 'Cashier',
  phone: 'Phone',
  drugLicence: 'Drug licence',
  fssai: 'FSSAI',
  billedTo: 'Billed to',
  placeOfSupply: 'Place of supply',
  item: 'Item',
  qty: 'Qty',
  rate: 'Rate',
  taxable: 'Taxable value',
  amount: 'Amount',
  inclusive: 'incl. GST',
  discount: 'Discount',
  subtotal: 'Subtotal',
  taxableValue: 'Taxable value',
  totalTax: 'Total tax',
  taxSummary: 'Tax summary',
  roundOff: 'Round off',
  grandTotal: 'Grand total',
  total: 'Total',
  paidBy: 'Paid by',
  cashGiven: 'Cash given',
  change: 'Change',
  amountInWords: 'Amount in words',
  signatory: 'Authorised signatory',
  forBusiness: 'For',
  payment: {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    cheque: 'Cheque',
    udhaar: 'Udhaar',
    advance: 'From advance',
  },
  units: {
    kg: 'kg',
    g: 'g',
    litre: 'litre',
    ml: 'ml',
    piece: 'piece',
    box: 'box',
    dozen: 'dozen',
    pack: 'pack',
    bag: 'bag',
    metre: 'metre',
    foot: 'foot',
    pair: 'pair',
  },
};

const hi: Labels = {
  documents: { tax_invoice: 'टैक्स इनवॉइस', bill_of_supply: 'बिल ऑफ सप्लाई', bill: 'बिल' },
  reprint: 'दोबारा छपा',
  billNo: 'बिल नं.',
  date: 'तारीख',
  time: 'समय',
  cashier: 'कैशियर',
  phone: 'फ़ोन',
  drugLicence: 'ड्रग लाइसेंस',
  fssai: 'FSSAI',
  billedTo: 'ग्राहक',
  placeOfSupply: 'आपूर्ति का स्थान',
  item: 'सामान',
  qty: 'मात्रा',
  rate: 'दर',
  taxable: 'कर योग्य मूल्य',
  amount: 'रकम',
  inclusive: 'GST सहित',
  discount: 'छूट',
  subtotal: 'उप-जोड़',
  taxableValue: 'कर योग्य मूल्य',
  totalTax: 'कुल कर',
  taxSummary: 'कर का सार',
  roundOff: 'पूर्णांक',
  grandTotal: 'कुल देय',
  total: 'कुल',
  paidBy: 'भुगतान',
  cashGiven: 'नकद मिला',
  change: 'लौटाया',
  amountInWords: 'शब्दों में रकम',
  signatory: 'अधिकृत हस्ताक्षरकर्ता',
  forBusiness: 'के लिए',
  payment: {
    cash: 'नकद',
    upi: 'यूपीआई',
    card: 'कार्ड',
    cheque: 'चेक',
    udhaar: 'उधार',
    advance: 'एडवांस से',
  },
  units: {
    kg: 'किलो',
    g: 'ग्राम',
    litre: 'लीटर',
    ml: 'मिली',
    piece: 'पीस',
    box: 'डिब्बा',
    dozen: 'दर्जन',
    pack: 'पैकेट',
    bag: 'बोरी',
    metre: 'मीटर',
    foot: 'फ़ुट',
    pair: 'जोड़ी',
  },
};

const hiLatn: Labels = {
  documents: { tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', bill: 'Bill' },
  reprint: 'Dobara chhapa',
  billNo: 'Bill no.',
  date: 'Tareekh',
  time: 'Samay',
  cashier: 'Cashier',
  phone: 'Phone',
  drugLicence: 'Drug licence',
  fssai: 'FSSAI',
  billedTo: 'Grahak',
  placeOfSupply: 'Aapoorti ka sthaan',
  item: 'Saamaan',
  qty: 'Maatra',
  rate: 'Dar',
  taxable: 'Kar yogya moolya',
  amount: 'Rakam',
  inclusive: 'GST sahit',
  discount: 'Chhoot',
  subtotal: 'Up-jod',
  taxableValue: 'Kar yogya moolya',
  totalTax: 'Kul kar',
  taxSummary: 'Kar ka saar',
  roundOff: 'Round off',
  grandTotal: 'Kul dey',
  total: 'Kul',
  paidBy: 'Bhugtaan',
  cashGiven: 'Cash mila',
  change: 'Wapas diya',
  amountInWords: 'Shabdon mein rakam',
  signatory: 'Adhikrit hastakshar',
  forBusiness: 'Ke liye',
  payment: {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    cheque: 'Cheque',
    udhaar: 'Udhaar',
    advance: 'Advance se',
  },
  units: {
    kg: 'kilo',
    g: 'gram',
    litre: 'litre',
    ml: 'ml',
    piece: 'piece',
    box: 'dibba',
    dozen: 'darjan',
    pack: 'packet',
    bag: 'bori',
    metre: 'meter',
    foot: 'foot',
    pair: 'jodi',
  },
};

export const LABELS: Record<BillLanguage, Labels> = { en, hi, 'hi-Latn': hiLatn };
