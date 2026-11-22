// Invoice numbers (P1.14; ADR 0007 rule 5): one counter row per branch per financial year,
// taken inside the bill's own transaction. The row stays locked until that transaction ends,
// so a save that rolls back gives its number back: no gaps, no duplicates. A database sequence
// isn't used because it never gives a number back.
import { sql } from 'drizzle-orm';
import { invoiceCounters } from './schema.js';
import type { Transaction } from './tenancy.js';

/**
 * The next number in a branch's series for a financial year (`2026-27`), starting at 1. Take it
 * after every check that can refuse the bill: other counters of the branch wait on this row
 * until the transaction ends. Two branches never wait on each other.
 */
export async function takeInvoiceSequence(
  tx: Transaction,
  input: { branchId: string; financialYear: string },
): Promise<number> {
  const [row] = await tx
    .insert(invoiceCounters)
    .values({ branchId: input.branchId, financialYear: input.financialYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [invoiceCounters.businessId, invoiceCounters.branchId, invoiceCounters.financialYear],
      set: { lastNumber: sql`${invoiceCounters.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: invoiceCounters.lastNumber });
  if (row === undefined) throw new Error('No invoice counter row returned');
  return row.lastNumber;
}
