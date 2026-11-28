import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  bills,
  customers,
  eq,
  gt,
  inArray,
  isNull,
  moveUdhaar,
  ne,
  or,
  recordEntry,
  sql,
  udhaarAccounts,
  udhaarEntries,
  UdhaarRuleError,
  type Database,
  type MoveUdhaarInput,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  UDHAAR_PAGE_SIZE,
  unpaidEntries,
  type LedgerEntry,
  type UdhaarCustomerRow,
  type UdhaarCustomersQuery,
  type UdhaarCustomersView,
  type UdhaarEntryKind,
  type UdhaarEntryView,
  type UdhaarLedgerQuery,
  type UdhaarLedgerView,
  type UdhaarMoveView,
  type UdhaarOpeningInput,
  type UdhaarPaymentInput,
  type UdhaarReversalInput,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { toView as toCustomerView } from '../customers/customers.service.js';
import { DATABASE } from '../database.module.js';
import { likeText } from '../http/like.js';
import { inBusiness } from '../items/conflicts.js';
import type { Caller } from '../http/session.js';

type EntryRow = typeof udhaarEntries.$inferSelect;

function toEntryView(row: EntryRow, billNumber: string | null): UdhaarEntryView {
  return {
    id: row.id,
    kind: row.kind as UdhaarEntryKind,
    amountPaise: row.amountPaise,
    balanceAfterPaise: row.balanceAfterPaise,
    billId: row.billId,
    billNumber,
    mode: row.mode as UdhaarEntryView['mode'],
    reference: row.reference,
    reversesEntryId: row.reversesEntryId,
    dueDate: row.dueDate,
    businessDate: row.businessDate,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A stored entry as `unpaidEntries` reads it, keeping the row for the answer. */
const asLedgerEntry = (row: EntryRow): LedgerEntry & EntryRow => ({
  ...row,
  kind: row.kind as UdhaarEntryKind,
});

/** What a rule of the ledger refused, as the screen's answer. */
function answerRule(error: unknown): never {
  if (error instanceof UdhaarRuleError) {
    switch (error.code) {
      case 'not_found':
        throw new NotFoundException({ code: 'customer_not_found' });
      case 'payment_not_found':
        throw new NotFoundException({ code: 'payment_not_found' });
      case 'already_reversed':
      case 'opening_exists':
        throw new ConflictException({ code: error.code });
    }
  }
  throw error;
}

/**
 * The udhaar ledger's routes (P1.18 design §6; Module 03). Every change goes through
 * `moveUdhaar`, in one transaction with its entry log row.
 */
@Injectable()
export class UdhaarService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  /** Customers with their balance, limit and oldest due date, a page at a time. */
  customers(caller: Caller, query: UdhaarCustomersQuery): Promise<UdhaarCustomersView> {
    return inBusiness(this.database, caller, async (tx) => {
      const balance = sql<number>`coalesce(${udhaarAccounts.balancePaise}, 0)`;
      const text = query.q ?? undefined;
      const rows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          creditLimitPaise: customers.creditLimitPaise,
          balancePaise: balance.mapWith(Number),
        })
        .from(customers)
        .leftJoin(udhaarAccounts, eq(udhaarAccounts.customerId, customers.id))
        .where(
          and(
            // An archived customer who still has a balance stays in view.
            or(isNull(customers.archivedAt), ne(balance, 0)),
            query.owing ? gt(balance, 0) : undefined,
            text === undefined
              ? undefined
              : sql`(${customers.name} ilike ${likeText(text)} or ${customers.phone} like ${likeText(text)})`,
          ),
        )
        .orderBy(asc(customers.name), asc(customers.id))
        .limit(UDHAAR_PAGE_SIZE + 1)
        .offset(query.offset);
      const page = rows.slice(0, UDHAAR_PAGE_SIZE);
      const owing = page.filter((row) => row.balancePaise > 0);
      const entries =
        owing.length === 0
          ? []
          : await tx
              .select()
              .from(udhaarEntries)
              .where(
                inArray(
                  udhaarEntries.customerId,
                  owing.map((row) => row.id),
                ),
              )
              .orderBy(asc(udhaarEntries.id));
      const oldestDue = new Map(
        owing.map((row) => {
          const own = entries.filter((entry) => entry.customerId === row.id);
          const dates = unpaidEntries(own.map(asLedgerEntry), row.balancePaise).flatMap(
            ({ entry }) => (entry.dueDate === null ? [] : [entry.dueDate]),
          );
          return [row.id, dates.sort()[0] ?? null];
        }),
      );
      return {
        customers: page.map((row): UdhaarCustomerRow => ({
          ...row,
          oldestDueDate: oldestDue.get(row.id) ?? null,
        })),
        more: rows.length > UDHAAR_PAGE_SIZE,
      };
    });
  }

  /** One customer's ledger, newest first and paged, and what of it is still unpaid. */
  ledger(caller: Caller, customerId: string, query: UdhaarLedgerQuery): Promise<UdhaarLedgerView> {
    return inBusiness(this.database, caller, async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (customer === undefined) throw new NotFoundException({ code: 'customer_not_found' });
      const [account] = await tx
        .select({ balancePaise: udhaarAccounts.balancePaise })
        .from(udhaarAccounts)
        .where(eq(udhaarAccounts.customerId, customerId));
      const balancePaise = account?.balancePaise ?? 0;
      const rows = await tx
        .select({ entry: udhaarEntries, billNumber: bills.number })
        .from(udhaarEntries)
        .leftJoin(bills, eq(bills.id, udhaarEntries.billId))
        .where(eq(udhaarEntries.customerId, customerId))
        .orderBy(asc(udhaarEntries.id));
      const numbers = new Map(rows.map(({ entry, billNumber }) => [entry.id, billNumber]));
      const view = (entry: EntryRow) => toEntryView(entry, numbers.get(entry.id) ?? null);
      const older = rows
        .map(({ entry }) => entry)
        .filter((entry) => query.before === undefined || entry.id < query.before)
        .reverse();
      const page = older.slice(0, UDHAAR_PAGE_SIZE);
      return {
        customerId,
        customer: toCustomerView(customer),
        balancePaise,
        creditLimitPaise: customer.creditLimitPaise,
        dueDays: customer.dueDays,
        entries: page.map(view),
        next: older.length > UDHAAR_PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
        unpaid: unpaidEntries(
          rows.map(({ entry }) => asLedgerEntry(entry)),
          balancePaise,
        ).map(({ entry, unpaidPaise }) => ({ entry: view(entry), unpaidPaise })),
      };
    });
  }

  /** `03` #3, #11: any amount at any time; a retry on the same key answers the first one. */
  recordPayment(caller: Caller, input: UdhaarPaymentInput): Promise<UdhaarMoveView> {
    const same = (row: EntryRow) =>
      row.kind === 'payment' &&
      row.customerId === input.customerId &&
      row.amountPaise === -input.amountPaise &&
      row.mode === input.mode &&
      row.reference === input.reference;
    return this.once(caller, input.requestKey, same, async (tx) => {
      const moved = await this.move(tx, caller, {
        customerId: input.customerId,
        kind: 'payment',
        amountPaise: -input.amountPaise,
        mode: input.mode,
        reference: input.reference,
        requestKey: input.requestKey,
      });
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'udhaar.payment_recorded',
        entityType: 'customer',
        entityId: input.customerId,
        branchId: caller.branchId,
        after: {
          entryId: moved.entryId,
          amountPaise: input.amountPaise,
          mode: input.mode,
          reference: input.reference,
          balanceAfterPaise: moved.balanceAfterPaise,
        },
      });
      return moved.entryId;
    });
  }

  /**
   * `03` #21: the owner takes a payment back with a reason and their password. The payment stays;
   * a reversing line is added, and the bills it had cleared are owed again.
   */
  async reversePayment(
    caller: Caller,
    paymentId: string,
    input: UdhaarReversalInput,
  ): Promise<UdhaarMoveView> {
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    return inBusiness(this.database, caller, async (tx) => {
      const [payment] = await tx
        .select({ customerId: udhaarEntries.customerId, amountPaise: udhaarEntries.amountPaise })
        .from(udhaarEntries)
        .where(and(eq(udhaarEntries.id, paymentId), eq(udhaarEntries.kind, 'payment')));
      if (payment === undefined) throw new NotFoundException({ code: 'payment_not_found' });
      const moved = await this.move(tx, caller, {
        customerId: payment.customerId,
        kind: 'payment_reversal',
        amountPaise: -payment.amountPaise,
        reversesEntryId: paymentId,
        reason: input.reason,
      });
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'udhaar.payment_reversed',
        entityType: 'customer',
        entityId: payment.customerId,
        branchId: caller.branchId,
        reason: input.reason,
        after: {
          entryId: moved.entryId,
          reversesEntryId: paymentId,
          amountPaise: -payment.amountPaise,
          balanceAfterPaise: moved.balanceAfterPaise,
        },
      });
      return this.answer(tx, moved.entryId);
    });
  }

  /** `03` #20: what the old notebook says the customer owed, once, at any time; the oldest entry. */
  async setOpening(caller: Caller, input: UdhaarOpeningInput): Promise<UdhaarMoveView> {
    // A future day would push the due date out, so the customer would never be overdue.
    if (input.asOf > businessDate(this.clock.now())) {
      throw new UnprocessableEntityException({ code: 'future_date' });
    }
    const same = (row: EntryRow) =>
      row.kind === 'opening' &&
      row.customerId === input.customerId &&
      row.amountPaise === input.amountPaise &&
      row.reason === input.reason;
    return this.once(caller, input.requestKey, same, async (tx) => {
      const moved = await this.move(tx, caller, {
        customerId: input.customerId,
        kind: 'opening',
        amountPaise: input.amountPaise,
        dueFrom: input.asOf,
        reason: input.reason,
        requestKey: input.requestKey,
      });
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'udhaar.opening_set',
        entityType: 'customer',
        entityId: input.customerId,
        branchId: caller.branchId,
        reason: input.reason,
        after: {
          entryId: moved.entryId,
          amountPaise: input.amountPaise,
          asOf: input.asOf,
          balanceAfterPaise: moved.balanceAfterPaise,
        },
      });
      return moved.entryId;
    });
  }

  /**
   * Runs `write` once per request key (ADR 0007 rule 7): a key already used answers the first
   * entry's view, or `422 key_reused` if this isn't the same request. A copy that ran at the same
   * time fails on the first's locks or key; if the first saved, its entry is the answer.
   */
  private async once(
    caller: Caller,
    requestKey: string,
    same: (row: EntryRow) => boolean,
    write: (tx: Transaction) => Promise<string>,
  ): Promise<UdhaarMoveView> {
    const replay = (tx: Transaction) => this.replay(tx, requestKey, same);
    try {
      return await inBusiness(this.database, caller, async (tx) => {
        return (await replay(tx)) ?? this.answer(tx, await write(tx));
      });
    } catch (error) {
      const saved = await inBusiness(this.database, caller, replay);
      if (saved !== null) return saved;
      throw error;
    }
  }

  private async replay(
    tx: Transaction,
    requestKey: string,
    same: (row: EntryRow) => boolean,
  ): Promise<UdhaarMoveView | null> {
    const [row] = await tx
      .select()
      .from(udhaarEntries)
      .where(eq(udhaarEntries.requestKey, requestKey));
    if (row === undefined) return null;
    if (!same(row)) throw new UnprocessableEntityException({ code: 'key_reused' });
    return this.answer(tx, row.id);
  }

  /** One entry at the caller's branch, on today's business day. */
  private async move(
    tx: Transaction,
    caller: Caller,
    entry: Pick<MoveUdhaarInput, 'customerId' | 'kind' | 'amountPaise'> & Partial<MoveUdhaarInput>,
  ) {
    try {
      return await moveUdhaar(tx, {
        branchId: caller.branchId,
        actorId: caller.userId,
        businessDate: businessDate(this.clock.now()),
        ...entry,
      });
    } catch (error) {
      return answerRule(error);
    }
  }

  /** An entry as saved, with the balance it left: what the receipt and the screen read. */
  private async answer(tx: Transaction, entryId: string): Promise<UdhaarMoveView> {
    const [row] = await tx
      .select({ entry: udhaarEntries, billNumber: bills.number })
      .from(udhaarEntries)
      .leftJoin(bills, eq(bills.id, udhaarEntries.billId))
      .where(eq(udhaarEntries.id, entryId));
    if (row === undefined) throw new Error(`Udhaar entry ${entryId} not found`);
    return {
      entry: toEntryView(row.entry, row.billNumber),
      customerId: row.entry.customerId,
      balancePaise: row.entry.balanceAfterPaise,
    };
  }
}
