// The only way a customer's udhaar balance changes (P1.18 design §4; ADR 0050). It takes a
// transaction, never the database, so an entry commits or rolls back with the bill or payment
// that caused it, its entry log row included. The balance is one locked row per customer
// (`udhaar_accounts`); every change adds a ledger entry that says what the balance became.
import { addDays, type UdhaarEntryKind } from '@business-software/shared';
import { and, eq, sql } from 'drizzle-orm';
import { customers, udhaarAccounts, udhaarEntries } from './schema.js';
import type { Transaction } from './tenancy.js';

export type UdhaarRuleCode =
  | 'not_found'
  | 'invalid'
  | 'advance_changed'
  | 'opening_exists'
  | 'payment_not_found'
  | 'already_reversed';

/** An entry broke an udhaar rule; nothing was written. The API turns `code` into its answer. */
export class UdhaarRuleError extends Error {
  constructor(
    readonly code: UdhaarRuleCode,
    readonly customerId: string,
    /** For `advance_changed`: the advance there really is, in paise. */
    readonly availablePaise = 0,
  ) {
    super(`Udhaar rule ${code}`);
    this.name = 'UdhaarRuleError';
  }
}

export interface MoveUdhaarInput {
  customerId: string;
  branchId: string;
  actorId: string;
  /** The IST day the entry belongs to (`06` #7). */
  businessDate: string;
  kind: UdhaarEntryKind;
  /** Signed: above 0 the customer owes more, below 0 they paid. Whole paise. */
  amountPaise: number;
  /** The day an entry above 0 falls due from; the business date unless an opening says so. */
  dueFrom?: string;
  /** For `bill` and `advance_used`. */
  billId?: string;
  /** For `payment`. */
  mode?: 'cash' | 'upi' | 'card' | 'cheque';
  reference?: string | null;
  /** For `payment_reversal`: the payment it takes back. */
  reversesEntryId?: string;
  /** For `payment_reversal` and `opening`. */
  reason?: string;
  /** Idempotency (ADR 0007 rule 7). A repeat is refused by the database (23505). */
  requestKey?: string;
}

export interface MovedUdhaar {
  entryId: string;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  dueDate: string | null;
}

/** The shape each kind must have, checked before anything is written. */
function isValid(input: MoveUdhaarInput): boolean {
  const { kind, amountPaise: amount } = input;
  if (!Number.isSafeInteger(amount)) return false;
  const reason = input.reason !== undefined && input.reason.trim() !== '';
  switch (kind) {
    case 'bill':
    case 'advance_used':
      return amount > 0 && input.billId !== undefined;
    case 'payment':
      return (
        amount < 0 &&
        input.mode !== undefined &&
        (input.mode !== 'cheque' || (input.reference ?? '') !== '')
      );
    case 'opening':
      return amount !== 0 && reason;
    case 'payment_reversal':
      return amount > 0 && reason && input.reversesEntryId !== undefined;
  }
}

/**
 * Makes the customer's account if it's their first entry, then locks it `FOR UPDATE` until the
 * transaction ends, and returns the balance (above 0 they owe, below 0 it's an advance). A bill
 * takes this lock last, after the invoice counter and the stock rows (ADR 0050), so it can't
 * deadlock with another bill; a payment takes only this one.
 */
export async function lockUdhaarAccount(tx: Transaction, customerId: string): Promise<number> {
  await tx
    .insert(udhaarAccounts)
    .values({ customerId })
    .onConflictDoNothing({ target: [udhaarAccounts.businessId, udhaarAccounts.customerId] });
  const [account] = await tx
    .select({ balancePaise: udhaarAccounts.balancePaise })
    .from(udhaarAccounts)
    .where(eq(udhaarAccounts.customerId, customerId))
    .for('update');
  if (account === undefined) throw new Error('No udhaar account row after locking');
  return account.balancePaise;
}

/**
 * Adds one entry to the customer's ledger and moves the balance with it: locks the account,
 * checks the rule for the kind, writes the entry with the balance after it, updates the account.
 * Throws `UdhaarRuleError` before writing anything if a rule breaks; the caller's transaction
 * should still roll back. Whether the new balance passes the credit limit is the caller's
 * decision (it needs the approval), made on the balance `lockUdhaarAccount` returned.
 */
export async function moveUdhaar(tx: Transaction, input: MoveUdhaarInput): Promise<MovedUdhaar> {
  const { customerId, kind } = input;
  if (!isValid(input)) throw new UdhaarRuleError('invalid', customerId);

  // Row Level Security hides another business's customer, so it's "not found" here too.
  const [customer] = await tx
    .select({ dueDays: customers.dueDays })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (customer === undefined) throw new UdhaarRuleError('not_found', customerId);

  const before = await lockUdhaarAccount(tx, customerId);

  if (kind === 'advance_used') {
    const available = Math.max(0, -before);
    if (input.amountPaise > available) {
      throw new UdhaarRuleError('advance_changed', customerId, available);
    }
  }
  if (kind === 'opening') {
    const [existing] = await tx
      .select({ id: udhaarEntries.id })
      .from(udhaarEntries)
      .where(and(eq(udhaarEntries.customerId, customerId), eq(udhaarEntries.kind, 'opening')));
    if (existing !== undefined) throw new UdhaarRuleError('opening_exists', customerId);
  }
  if (kind === 'payment_reversal') await checkReversal(tx, input);

  const after = before + input.amountPaise;
  const dueDate =
    input.amountPaise > 0 ? addDays(input.dueFrom ?? input.businessDate, customer.dueDays) : null;
  const [entry] = await tx
    .insert(udhaarEntries)
    .values({
      customerId,
      branchId: input.branchId,
      kind,
      amountPaise: input.amountPaise,
      balanceAfterPaise: after,
      billId: input.billId ?? null,
      mode: kind === 'payment' ? (input.mode ?? null) : null,
      reference: kind === 'payment' ? (input.reference ?? null) : null,
      reversesEntryId: input.reversesEntryId ?? null,
      dueDate,
      businessDate: input.businessDate,
      requestKey: input.requestKey ?? null,
      reason: input.reason ?? null,
      createdBy: input.actorId,
    })
    .returning({ id: udhaarEntries.id });
  if (entry === undefined) throw new Error('No udhaar entry row returned');
  await tx
    .update(udhaarAccounts)
    .set({ balancePaise: after, lastEntryId: entry.id, updatedAt: new Date() })
    .where(eq(udhaarAccounts.customerId, customerId));
  return { entryId: entry.id, balanceBeforePaise: before, balanceAfterPaise: after, dueDate };
}

/** A reversal takes back one payment of this customer, once, for exactly what it took. */
async function checkReversal(tx: Transaction, input: MoveUdhaarInput): Promise<void> {
  const { customerId, reversesEntryId } = input;
  if (reversesEntryId === undefined) throw new UdhaarRuleError('invalid', customerId);
  const [payment] = await tx
    .select({ amountPaise: udhaarEntries.amountPaise })
    .from(udhaarEntries)
    .where(
      and(
        eq(udhaarEntries.id, reversesEntryId),
        eq(udhaarEntries.customerId, customerId),
        eq(udhaarEntries.kind, 'payment'),
      ),
    );
  if (payment === undefined) throw new UdhaarRuleError('payment_not_found', customerId);
  const [reversal] = await tx
    .select({ id: udhaarEntries.id })
    .from(udhaarEntries)
    .where(eq(udhaarEntries.reversesEntryId, reversesEntryId));
  if (reversal !== undefined) throw new UdhaarRuleError('already_reversed', customerId);
  if (input.amountPaise !== -payment.amountPaise) throw new UdhaarRuleError('invalid', customerId);
}

export interface UdhaarMismatch {
  customerId: string;
  balancePaise: number;
  /** The sum of the customer's entries. */
  summedPaise: number;
  /** The balance after the entry the account says came last; null if there is none. */
  lastBalancePaise: number | null;
}

/**
 * Accounts that disagree with their ledger, in the current business: a balance that isn't the
 * sum of its entries or the balance after its last one, an entry whose balance after isn't the
 * running sum up to it, or entries with no account. Empty means the ledger holds. Tests run it
 * after every udhaar test.
 */
export async function findUdhaarMismatches(tx: Transaction): Promise<UdhaarMismatch[]> {
  const { rows } = await tx.execute<{
    customer_id: string;
    balance: string;
    summed: string;
    last_balance: string | null;
  }>(sql`
    with running as (
      select customer_id, balance_after_paise,
             sum(amount_paise) over (partition by customer_id order by id) as running
        from udhaar_entries),
    sums as (
      select customer_id, sum(amount_paise) as summed from udhaar_entries group by customer_id),
    broken as (
      select distinct customer_id from running where running <> balance_after_paise)
    select coalesce(a.customer_id, s.customer_id) as customer_id,
           coalesce(a.balance_paise, 0) as balance,
           coalesce(s.summed, 0) as summed,
           (select e.balance_after_paise from udhaar_entries e where e.id = a.last_entry_id)
             as last_balance
      from udhaar_accounts a
      full join sums s on s.customer_id = a.customer_id
     where a.customer_id is null
        or a.balance_paise <> coalesce(s.summed, 0)
        or a.balance_paise is distinct from coalesce(
             (select e.balance_after_paise from udhaar_entries e where e.id = a.last_entry_id), 0)
        or a.customer_id in (select customer_id from broken)
     order by 1`);
  return rows.map((row) => ({
    customerId: row.customer_id,
    balancePaise: Number(row.balance),
    summedPaise: Number(row.summed),
    lastBalancePaise: row.last_balance === null ? null : Number(row.last_balance),
  }));
}
