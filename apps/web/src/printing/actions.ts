// What the buttons and keys of a saved bill do (P1.15 design section 4): print it, or open a
// WhatsApp chat about it. Both read the bill from the server, so the Bills page and the
// counter's "Bill saved" panel print exactly the same thing.
import {
  formatPaise,
  whatsAppLink,
  type BillDetailView,
  type PrintSize,
  type ReceiptSize,
  type ReprintView,
} from '@business-software/shared';
import { apiRequest } from '../api/client';
import { i18n } from '../i18n';
import { printBill } from './print-bill';

/**
 * `02` #31: a bill with the buyer's GSTIN prints on A4 by default, even at a receipt counter
 * (the buyer files it for their input tax credit); every other bill uses the counter's paper.
 */
export function defaultSize(bill: BillDetailView, receiptSize: ReceiptSize): PrintSize {
  if (bill.buyer !== null && bill.buyer.gstin !== null) return 'a4';
  return receiptSize === 80 ? '80' : '58';
}

/**
 * Prints a saved bill. `size` is a paper size, or `auto` for the bill's own default (`02` #31).
 * A reprint is logged first, and its date goes on the paper (`02` #32, #33); the first print of
 * a bill is not a reprint.
 */
export async function printSavedBill(input: {
  id: string;
  size: PrintSize | 'auto';
  receiptSize: ReceiptSize;
  reprint: boolean;
}): Promise<void> {
  const bill = await apiRequest<BillDetailView>('GET', `/api/bills/${input.id}`);
  const reprintedAt = input.reprint
    ? (await apiRequest<ReprintView>('POST', `/api/bills/${input.id}/reprints`)).reprintedAt
    : null;
  await printBill(
    bill,
    input.size === 'auto' ? defaultSize(bill, input.receiptSize) : input.size,
    reprintedAt,
  );
}

/**
 * Opens WhatsApp with the customer's number and a short message in the bill language (`02` #27,
 * ADR 0049); the owner presses send there. Answers false when the bill has no customer phone.
 */
export async function sendOnWhatsApp(id: string): Promise<boolean> {
  const bill = await apiRequest<BillDetailView>('GET', `/api/bills/${id}`);
  if (bill.customerPhone === null) return false;
  const text = i18n.getFixedT(bill.language)('printing.whatsapp', {
    shop: bill.seller.businessName,
    number: bill.number,
    total: formatPaise(bill.grandTotalPaise),
  });
  window.open(whatsAppLink(bill.customerPhone, text), '_blank', 'noopener');
  return true;
}
