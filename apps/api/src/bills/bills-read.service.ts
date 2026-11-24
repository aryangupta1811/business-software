// Reading saved bills (P1.15; `02` #32, #33): the Bills page's list, one bill for printing, and
// the entry-log row a reprint leaves. A bill is append-only (ADR 0047), so nothing here writes
// one. Staff see only the branch they are logged in at; the owner sees every branch's.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  billLines,
  billPayments,
  bills,
  branches,
  businesses,
  customers,
  desc,
  eq,
  lt,
  recordEntry,
  sql,
  users,
  type Database,
  type SQL,
  type Transaction,
} from '@business-software/db';
import type {
  BillBuyerView,
  BillDetailView,
  BillLanguage,
  BillListPage,
  BillListQuery,
  BillSellerView,
  PaymentMode,
  ReprintView,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { branchScope } from '../branches/scope.js';
import { DATABASE } from '../database.module.js';
import { likeText } from '../http/like.js';
import type { Caller } from '../http/session.js';
import { inBusiness } from '../items/conflicts.js';

/** Bills per page of the list. */
export const BILLS_PAGE_SIZE = 30;

@Injectable()
export class BillsReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A page of bills, newest first (the ids are time-ordered, so the id is the cursor). */
  list(caller: Caller, query: BillListQuery): Promise<BillListPage> {
    const scope = branchScope(caller, query.branch, 'all');
    const seesPhones = caller.permissions.includes('customers.view');
    return inBusiness(this.database, caller, async (tx) => {
      const conditions: (SQL | undefined)[] = [
        scope === 'all' ? undefined : eq(bills.branchId, scope),
        query.from === undefined ? undefined : sql`${bills.businessDate} >= ${query.from}`,
        query.to === undefined ? undefined : sql`${bills.businessDate} <= ${query.to}`,
        query.after === undefined ? undefined : lt(bills.id, query.after),
      ];
      if (query.q !== undefined) {
        const like = likeText(query.q);
        conditions.push(
          sql`(${bills.number} ilike ${like} or ${bills.buyer}->>'name' ilike ${like}
            or ${customers.name} ilike ${like} or (${seesPhones} and ${customers.phone} like ${like}))`,
        );
      }
      const rows = await tx
        .select({
          id: bills.id,
          number: bills.number,
          document: bills.document,
          businessDate: bills.businessDate,
          createdAt: bills.createdAt,
          grandTotalPaise: bills.grandTotalPaise,
          branchId: bills.branchId,
          branchCode: branches.code,
          customerName: sql<string | null>`coalesce(${bills.buyer}->>'name', ${customers.name})`,
          customerPhone: customers.phone,
          paymentModes: sql<
            PaymentMode[]
          >`coalesce((select array_agg(distinct p.mode order by p.mode)
            from bill_payments p where p.bill_id = ${bills.id}), '{}')`,
        })
        .from(bills)
        .innerJoin(
          branches,
          and(eq(branches.businessId, bills.businessId), eq(branches.id, bills.branchId)),
        )
        .leftJoin(
          customers,
          and(eq(customers.businessId, bills.businessId), eq(customers.id, bills.customerId)),
        )
        .where(and(...conditions))
        .orderBy(desc(bills.id))
        .limit(BILLS_PAGE_SIZE + 1);
      const page = rows.slice(0, BILLS_PAGE_SIZE);
      return {
        bills: page.map((row) => ({
          ...row,
          customerPhone: seesPhones ? row.customerPhone : null,
          document: row.document as BillDetailView['document'],
          createdAt: row.createdAt.toISOString(),
        })),
        next: rows.length > BILLS_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** One bill with its lines and payments, as the printout draws it. */
  one(caller: Caller, id: string): Promise<BillDetailView> {
    return inBusiness(this.database, caller, (tx) => this.detail(tx, caller, id));
  }

  /**
   * Logs that a bill was printed again and says when, for the "Reprint" line (`02` #32, #33).
   * The bill is read first, so a cashier can't log a reprint of another branch's bill.
   */
  reprint(caller: Caller, id: string): Promise<ReprintView> {
    return inBusiness(this.database, caller, async (tx) => {
      const bill = await this.detail(tx, caller, id);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'bill.reprinted',
        entityType: 'bill',
        entityId: id,
        branchId: caller.branchId,
        after: { number: bill.number },
      });
      return { reprintedAt: this.clock.now().toISOString() };
    });
  }

  private async detail(tx: Transaction, caller: Caller, id: string): Promise<BillDetailView> {
    const [row] = await tx
      .select({
        bill: bills,
        cashierName: sql<string | null>`coalesce(${users.name}, ${users.username})`,
        customerPhone: customers.phone,
        language: businesses.billLanguage,
        footerNote: businesses.billFooterNote,
      })
      .from(bills)
      .innerJoin(users, and(eq(users.businessId, bills.businessId), eq(users.id, bills.createdBy)))
      .innerJoin(businesses, eq(businesses.id, bills.businessId))
      .leftJoin(
        customers,
        and(eq(customers.businessId, bills.businessId), eq(customers.id, bills.customerId)),
      )
      .where(
        and(
          eq(bills.id, id),
          caller.role === 'owner' ? undefined : eq(bills.branchId, caller.branchId),
        ),
      );
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    const { bill } = row;
    const lines = await tx
      .select()
      .from(billLines)
      .where(eq(billLines.billId, id))
      .orderBy(asc(billLines.lineNo));
    const payments = await tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.billId, id))
      .orderBy(asc(billPayments.id));
    return {
      id: bill.id,
      number: bill.number,
      document: bill.document as BillDetailView['document'],
      businessDate: bill.businessDate,
      createdAt: bill.createdAt.toISOString(),
      cashierName: row.cashierName,
      seller: bill.seller as BillSellerView,
      buyer: bill.buyer as BillBuyerView | null,
      customerPhone: caller.permissions.includes('customers.view') ? row.customerPhone : null,
      tax: bill.tax as BillDetailView['tax'],
      supplierStateCode: bill.supplierStateCode,
      placeOfSupplyStateCode: bill.placeOfSupplyStateCode,
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        itemName: line.itemName,
        itemHindiName: line.itemHindiName,
        unit: line.unit,
        hsn: line.hsn,
        rateBasisPoints: line.rateBasisPoints,
        quantityThousandths: line.quantityThousandths,
        unitPricePaise: line.unitPricePaise,
        priceIncludesTax: line.priceIncludesTax,
        amountPaise: line.amountPaise,
        itemDiscountPaise: line.itemDiscountPaise,
        grossPaise: line.grossPaise,
        subtotalPaise: line.subtotalPaise,
        billDiscountPaise: line.billDiscountPaise,
        taxableBeforeDiscountsPaise: line.taxableBeforeDiscountsPaise,
        discountOffTaxablePaise: line.discountOffTaxablePaise,
        taxablePaise: line.taxablePaise,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        igstPaise: line.igstPaise,
        totalPaise: line.totalPaise,
      })),
      payments: payments.map((payment) => ({
        mode: payment.mode as PaymentMode,
        amountPaise: payment.amountPaise,
        tenderedPaise: payment.tenderedPaise,
        reference: payment.reference,
      })),
      grossPaise: bill.grossPaise,
      subtotalPaise: bill.subtotalPaise,
      billDiscountPaise: bill.billDiscountPaise,
      taxablePaise: bill.taxablePaise,
      cgstPaise: bill.cgstPaise,
      sgstPaise: bill.sgstPaise,
      igstPaise: bill.igstPaise,
      totalPaise: bill.totalPaise,
      roundOffPaise: bill.roundOffPaise,
      grandTotalPaise: bill.grandTotalPaise,
      changePaise: changeOf(payments),
      language: row.language as BillLanguage,
      footerNote: row.footerNote,
    };
  }
}

/** The cash handed over beyond what it paid: the change the counter showed at saving. */
function changeOf(payments: { amountPaise: number; tenderedPaise: number | null }[]): number {
  return payments.reduce(
    (change, payment) =>
      payment.tenderedPaise === null
        ? change
        : change + payment.tenderedPaise - payment.amountPaise,
    0,
  );
}
