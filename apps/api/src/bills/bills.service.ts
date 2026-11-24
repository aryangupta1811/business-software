import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
  type HttpException,
} from '@nestjs/common';
import {
  and,
  asc,
  billLines,
  billPayments,
  bills,
  branches,
  businesses,
  customers,
  eq,
  heldBills,
  inArray,
  isNull,
  items,
  itemUnits,
  lockUdhaarAccount,
  moveStock,
  moveUdhaar,
  ownerApprovals,
  recordEntry,
  sql,
  stockMovements,
  StockRuleError,
  takeInvoiceSequence,
  udhaarEntries,
  UdhaarRuleError,
  units,
  users,
  type Database,
  type MovedLine,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  calculateBill,
  cartToBillInput,
  creditLimitVerdict,
  discountShares,
  discountWithinLimit,
  documentFor,
  effectiveDiscountLimit,
  financialYear,
  invoiceLabel,
  invoiceNumber,
  needsBuyerDetails,
  paymentIssues,
  stockQuantity,
  type BillDocument,
  type BillDraft,
  type BuiltInUnit,
  type CatalogueEntry,
  type CatalogueItem,
  type CataloguePack,
  type Feature,
  type ItemKind,
  type NegativeStockSetting,
  type OverCreditLimitSetting,
  type PaymentMode,
  type SavedBillView,
  type TaxScheme,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { DATABASE } from '../database.module.js';
import { inBusiness } from '../items/conflicts.js';
import type { Caller } from '../http/session.js';

/** A retry must be the same request to get the saved bill back (ADR 0007 rule 7). */
function hashOf(draft: BillDraft): string {
  return createHash('sha256').update(JSON.stringify(draft)).digest('hex');
}

/** What `moveStock` refused, as the counter's answer. Other codes can't happen for a sale. */
function stockAnswer(error: StockRuleError): HttpException | StockRuleError {
  switch (error.code) {
    case 'below_zero':
      return new ConflictException({ code: 'stock_short', itemId: error.itemId });
    case 'invalid':
    case 'whole_units_only':
      return new UnprocessableEntityException({
        code: 'invalid_quantity',
        itemId: error.itemId,
        reason: error.code,
      });
    default:
      return error;
  }
}

/** What the draft pays in one mode, in paise. */
function paidBy(draft: BillDraft, mode: PaymentMode): number {
  return draft.payments
    .filter((payment) => payment.mode === mode)
    .reduce((sum, payment) => sum + payment.amountPaise, 0);
}

function packOf(item: CatalogueItem, packId: string | null): CataloguePack | null {
  return packId === null ? null : (item.packs.find((pack) => pack.id === packId) ?? null);
}

/**
 * Saving a bill (P1.14, design `docs/plans/2026-11-22-p1.14-save-bill-design.md` §3): one
 * transaction that re-prices and re-checks everything, numbers the bill with no gaps, stores it
 * for good, takes the stock out and logs it. The browser's numbers are never trusted.
 */
@Injectable()
export class BillsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async save(caller: Caller, draft: BillDraft): Promise<SavedBillView> {
    const requestHash = hashOf(draft);
    try {
      return await inBusiness(this.database, caller, async (tx) => {
        const saved = await this.replay(tx, caller, draft.billKey, requestHash);
        return saved ?? (await this.create(tx, caller, draft, requestHash));
      });
    } catch (error) {
      // A copy of this request that ran at the same time (a retry while the first was still
      // saving) waits on the first's locks and then fails: on the bill key, the used approval or
      // the stock the first took. If the first saved, its bill is the answer.
      const saved = await inBusiness(this.database, caller, (tx) =>
        this.replay(tx, caller, draft.billKey, requestHash),
      );
      if (saved !== null) return saved;
      throw error;
    }
  }

  /** The bill saved with this key, if any; `422 key_reused` if it was a different request. */
  private async replay(
    tx: Transaction,
    caller: Caller,
    billKey: string,
    requestHash: string,
  ): Promise<SavedBillView | null> {
    const [row] = await tx
      .select({ id: bills.id, branchId: bills.branchId, requestHash: bills.requestHash })
      .from(bills)
      .where(eq(bills.billKey, billKey));
    if (row === undefined) return null;
    if (row.requestHash !== requestHash || row.branchId !== caller.branchId) {
      throw new UnprocessableEntityException({ code: 'key_reused' });
    }
    return this.view(tx, row.id);
  }

  private async create(
    tx: Transaction,
    caller: Caller,
    draft: BillDraft,
    requestHash: string,
  ): Promise<SavedBillView> {
    const now = this.clock.now();
    // 2. The business and the selling branch: always the session's computer's (ADR 0045).
    const [business] = await tx
      .select({
        name: businesses.name,
        gstStatus: businesses.gstStatus,
        features: businesses.features,
        negativeStock: businesses.negativeStock,
        overCreditLimit: businesses.overCreditLimit,
        invoicePrefix: businesses.invoicePrefix,
      })
      .from(businesses);
    const [branch] = await tx.select().from(branches).where(eq(branches.id, caller.branchId));
    if (business === undefined || branch === undefined) {
      throw new Error("The caller's business or branch is missing");
    }
    // GST_STATUSES and the engine's schemes are the same three words.
    const scheme = business.gstStatus as TaxScheme;

    // 3. A tax invoice or bill of supply carries the selling branch's GSTIN (`02` #25).
    if (scheme !== 'unregistered' && branch.gstin === null) {
      throw new ConflictException({ code: 'gstin_required' });
    }

    // 4. Every item as it is now, locked against edits until the bill is saved.
    if (
      draft.priceList === 'wholesale' &&
      !(business.features as Feature[]).includes('wholesale_price')
    ) {
      throw new UnprocessableEntityException({ code: 'wholesale_off' });
    }
    const catalogue = await this.catalogue(tx, [...new Set(draft.lines.map((l) => l.itemId))]);
    const live = (itemId: string): CatalogueItem => {
      const entry = catalogue.get(itemId);
      if (entry === undefined || entry.archived) throw new Error(`Item ${itemId} not checked`);
      return entry;
    };
    const unavailable = draft.lines.flatMap((line, index) => {
      const item = catalogue.get(line.itemId);
      const sellable =
        item !== undefined &&
        !item.archived &&
        (scheme !== 'regular' || (item.gstRate !== null && item.hsn !== null)) &&
        (line.packId === null || packOf(item, line.packId)?.soldAsPack === true);
      return sellable ? [] : [index + 1];
    });
    if (unavailable.length > 0) {
      throw new ConflictException({ code: 'items_unavailable', lines: unavailable });
    }

    // 5. The server's own prices and sums; the cashier must have seen the same.
    const input = cartToBillInput(
      {
        priceList: draft.priceList,
        placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
        lines: draft.lines.map(({ discount, ...line }) =>
          discount === undefined ? line : { ...line, discount },
        ),
        ...(draft.billDiscount !== undefined && { billDiscount: draft.billDiscount }),
      },
      { scheme, supplierStateCode: branch.stateCode, catalogue },
    );
    const bill = calculateBill(input);
    const changed = input.lines.flatMap((line, index) =>
      line.unitPricePaise === draft.lines[index]?.shownUnitPricePaise
        ? []
        : [{ line: index + 1, unitPricePaise: line.unitPricePaise }],
    );
    if (changed.length > 0 || bill.grandTotalPaise !== draft.shownGrandTotalPaise) {
      throw new ConflictException({
        code: 'prices_changed',
        lines: changed,
        grandTotalPaise: bill.grandTotalPaise,
      });
    }

    // 6. The payments add up to the server's total (`02` #11).
    if (paymentIssues(draft.payments, bill.grandTotalPaise).length > 0) {
      throw new UnprocessableEntityException({ code: 'payments_mismatch' });
    }

    // 7. The customer as they are now, copied onto the bill.
    const { buyer, phone, creditLimitPaise } = await this.buyer(tx, draft, branch.stateCode);
    const named = buyer === null ? false : buyer.address !== null && buyer.stateCode !== null;
    if (
      !named &&
      needsBuyerDetails({
        scheme,
        taxablePaise: bill.taxablePaise,
        buyerGstin: buyer?.gstin ?? null,
      })
    ) {
      throw new UnprocessableEntityException({ code: 'buyer_details_required' });
    }

    // 7b. Udhaar and advance belong to a customer, and udhaar to one with a name and phone
    // (`03` #1); staff give udhaar only with the switch on (`03` #10).
    const udhaarPaise = paidBy(draft, 'udhaar');
    const advancePaise = paidBy(draft, 'advance');
    if ((udhaarPaise > 0 || advancePaise > 0) && draft.customerId === null) {
      throw new UnprocessableEntityException({ code: 'udhaar_needs_customer' });
    }
    if (udhaarPaise > 0 && phone === null) {
      throw new UnprocessableEntityException({ code: 'udhaar_needs_phone' });
    }
    if (udhaarPaise > 0 && !caller.permissions.includes('billing.udhaar')) {
      throw new ForbiddenException({ code: 'udhaar_not_allowed' });
    }

    // 8. Discounts above the cashier's limit need the owner's OK, used up here (`02` #12).
    const approvalId = await this.useApproval(tx, caller, draft, input, now);
    const creditApprovalId = await this.useCreditApproval(tx, caller, draft, udhaarPaise, now);

    // 9. A bill resumed from the held list keeps a link to it; resuming already closed it.
    if (draft.heldBillId !== undefined) {
      const [held] = await tx
        .select({
          branchId: heldBills.branchId,
          billKey: heldBills.billKey,
          resumedAt: heldBills.resumedAt,
        })
        .from(heldBills)
        .where(eq(heldBills.id, draft.heldBillId));
      if (
        held?.branchId !== caller.branchId ||
        held.billKey !== draft.billKey ||
        held.resumedAt === null
      ) {
        throw new UnprocessableEntityException({ code: 'held_bill_invalid' });
      }
    }

    // 10. The number, after every check that can refuse the bill: other counters of the branch
    // wait on the counter row until this transaction ends (ADR 0007 rule 5).
    const date = businessDate(now);
    const year = financialYear(date);
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(branches)
      .where(isNull(branches.archivedAt));
    const label = invoiceLabel({
      prefix: business.invoicePrefix,
      branchCode: branch.code,
      branchCount: active?.count ?? 1,
    });
    const sequence = await takeInvoiceSequence(tx, {
      branchId: caller.branchId,
      financialYear: year,
    });
    const number = invoiceNumber({ label, financialYear: year, sequence });
    const document: BillDocument = documentFor(scheme);

    // 11. The bill, never edited after this (ADR 0047).
    const [row] = await tx
      .insert(bills)
      .values({
        branchId: caller.branchId,
        billKey: draft.billKey,
        requestHash,
        financialYear: year,
        sequence,
        number,
        document,
        businessDate: date,
        priceList: draft.priceList,
        supplierStateCode: branch.stateCode,
        placeOfSupplyStateCode: draft.placeOfSupplyStateCode,
        tax: bill.tax,
        customerId: draft.customerId,
        buyer,
        seller: {
          businessName: business.name,
          branchName: branch.name,
          address: branch.address,
          pinCode: branch.pinCode,
          stateCode: branch.stateCode,
          gstin: branch.gstin,
          drugLicence: branch.drugLicence,
          fssai: branch.fssai,
        },
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
        billDiscount: draft.billDiscount ?? null,
        approvalId,
        creditApprovalId,
        heldBillId: draft.heldBillId ?? null,
        createdBy: caller.userId,
        createdAt: now,
      })
      .returning({ id: bills.id });
    if (row === undefined) throw new Error('No bill row returned');

    // 12. Goods leave the branch's stock; a pack takes quantity × its size. Services don't.
    const goods = draft.lines.flatMap((line, index) => {
      const item = live(line.itemId);
      if (item.kind !== 'goods') return [];
      const pack = packOf(item, line.packId);
      return [{ index, stock: stockQuantity(line.quantityThousandths, pack?.size ?? null) }];
    });
    let moved: MovedLine[];
    try {
      moved = await moveStock(tx, {
        branchId: caller.branchId,
        actorId: caller.userId,
        businessDate: date,
        belowZero: business.negativeStock as NegativeStockSetting,
        billId: row.id,
        lines: goods.map(({ index, stock }) => ({
          itemId: draft.lines[index]?.itemId ?? '',
          kind: 'sale' as const,
          quantity: -stock,
        })),
      });
    } catch (error) {
      // The whole save rolls back, its number included: the next bill gets that number.
      throw error instanceof StockRuleError ? stockAnswer(error) : error;
    }
    // 12b. Last of all, the customer's account (ADR 0050: after the invoice counter and the stock
    // rows, so two bills can never wait on each other). The advance goes first, then the rest is
    // owed; whether that is past the credit limit is decided on the balance now locked.
    const ledger = await this.moveLedger(tx, caller, {
      customerId: draft.customerId,
      billId: row.id,
      businessDate: date,
      udhaarPaise,
      advancePaise,
      limitPaise: creditLimitPaise,
      setting: business.overCreditLimit as OverCreditLimitSetting,
      approved: creditApprovalId !== null,
    });
    const stockOf = new Map(goods.map(({ index, stock }, at) => [index, { stock, at }]));

    await tx.insert(billLines).values(
      draft.lines.map((line, index) => {
        const item = live(line.itemId);
        const pack = packOf(item, line.packId);
        const amounts = bill.lines[index];
        const priced = input.lines[index];
        if (amounts === undefined || priced === undefined) throw new Error('Line not priced');
        const out = stockOf.get(index);
        return {
          billId: row.id,
          lineNo: index + 1,
          itemId: line.itemId,
          packId: line.packId,
          itemName: item.name,
          itemHindiName: item.hindiName,
          unit: pack === null ? item.stockUnit : (pack.unitCode ?? pack.unitName ?? ''),
          hsn: amounts.hsn,
          rateBasisPoints: amounts.rateBasisPoints,
          priceIncludesTax: priced.priceIncludesTax,
          quantityThousandths: line.quantityThousandths,
          stockQuantity: out?.stock ?? null,
          unitPricePaise: priced.unitPricePaise,
          discount: line.discount ?? null,
          amountPaise: amounts.amountPaise,
          itemDiscountPaise: amounts.itemDiscountPaise,
          grossPaise: amounts.grossPaise,
          subtotalPaise: amounts.subtotalPaise,
          billDiscountPaise: amounts.billDiscountPaise,
          taxableBeforeDiscountsPaise: amounts.taxableBeforeDiscountsPaise,
          discountOffTaxablePaise: amounts.discountOffTaxablePaise,
          taxablePaise: amounts.taxablePaise,
          cgstPaise: amounts.cgstPaise,
          sgstPaise: amounts.sgstPaise,
          igstPaise: amounts.igstPaise,
          totalPaise: amounts.totalPaise,
          unitCost: out === undefined ? null : (moved[out.at]?.unitCost ?? null),
          createdAt: now,
        };
      }),
    );
    if (draft.payments.length > 0) {
      await tx.insert(billPayments).values(
        draft.payments.map((payment) => ({
          billId: row.id,
          mode: payment.mode,
          amountPaise: payment.amountPaise,
          tenderedPaise: payment.tenderedPaise ?? null,
          reference: payment.reference ?? null,
          createdAt: now,
        })),
      );
    }

    // 13. The log: every discount, who allowed it, and what went below zero (`02` #12).
    await recordEntry(tx, {
      actorId: caller.userId,
      action: 'bill.created',
      entityType: 'bill',
      entityId: row.id,
      branchId: caller.branchId,
      after: {
        number,
        document,
        businessDate: date,
        customerId: draft.customerId,
        lineCount: draft.lines.length,
        taxablePaise: bill.taxablePaise,
        grandTotalPaise: bill.grandTotalPaise,
        lineDiscounts: draft.lines.flatMap((line, index) =>
          line.discount === undefined ? [] : [{ line: index + 1, ...line.discount }],
        ),
        billDiscount: draft.billDiscount ?? null,
        approvalId,
        creditApprovalId,
        udhaarPaise,
        advancePaise,
        udhaarBalanceAfterPaise: ledger,
        heldBillId: draft.heldBillId ?? null,
        warned: moved
          .filter((line) => line.warned)
          .map((line) => ({ itemId: line.itemId, balanceAfter: line.balanceAfter })),
      },
    });
    return this.view(tx, row.id);
  }

  /** The bill's items as the counter's catalogue holds them, read with a share lock. */
  private async catalogue(
    tx: Transaction,
    itemIds: string[],
  ): Promise<Map<string, CatalogueEntry>> {
    const rows = await tx
      .select()
      .from(items)
      .where(inArray(items.id, itemIds))
      .orderBy(asc(items.id))
      .for('share');
    const packRows = await tx
      .select({ pack: itemUnits, unitName: units.name })
      .from(itemUnits)
      .leftJoin(units, eq(units.id, itemUnits.unitId))
      .where(and(inArray(itemUnits.itemId, itemIds), isNull(itemUnits.archivedAt)));
    const catalogue = new Map<string, CatalogueEntry>();
    for (const item of rows) {
      catalogue.set(
        item.id,
        item.archivedAt !== null
          ? { id: item.id, archived: true, name: item.name, barcodes: [] }
          : {
              id: item.id,
              archived: false,
              kind: item.kind as ItemKind,
              name: item.name,
              hindiName: item.hindiName,
              code: item.code,
              stockUnit: item.stockUnit as BuiltInUnit,
              sellingPrice: item.sellingPrice,
              wholesalePrice: item.wholesalePrice,
              mrp: item.mrp,
              priceIncludesTax: item.priceIncludesTax,
              gstRate: item.gstRate,
              hsn: item.hsn,
              version: item.version,
              packs: packRows
                .filter(({ pack }) => pack.itemId === item.id)
                .map(({ pack, unitName }) => ({
                  id: pack.id,
                  unitCode: pack.unitCode as BuiltInUnit | null,
                  unitName,
                  size: pack.size,
                  sellingPrice: pack.sellingPrice,
                  mrp: pack.mrp,
                  soldAsPack: pack.soldAsPack,
                })),
              barcodes: [],
            },
      );
    }
    return catalogue;
  }

  /**
   * The customer's details as they are now, for the bill's own copy, with what udhaar needs of
   * them: the phone and the credit limit. A business customer's bill
   * is supplied either in their state or at the counter (P1.13 design §7).
   */
  private async buyer(tx: Transaction, draft: BillDraft, branchStateCode: string) {
    if (draft.customerId === null) return { buyer: null, phone: null, creditLimitPaise: null };
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, draft.customerId))
      .for('share');
    if (customer?.archivedAt !== null) {
      throw new ConflictException({ code: 'customer_unavailable' });
    }
    if (
      customer.gstin !== null &&
      draft.placeOfSupplyStateCode !== branchStateCode &&
      draft.placeOfSupplyStateCode !== customer.stateCode
    ) {
      throw new UnprocessableEntityException({ code: 'place_of_supply' });
    }
    return {
      buyer: {
        name: customer.name,
        gstin: customer.gstin,
        legalName: customer.legalName,
        address: customer.address,
        pinCode: customer.pinCode,
        stateCode: customer.stateCode,
      },
      phone: customer.phone,
      creditLimitPaise: customer.creditLimitPaise,
    };
  }

  /**
   * Null when the bill's discounts are within the caller's limit. Otherwise the owner's OK for
   * this bill, marked used in the same statement that checks it, so two saves can't both use it.
   */
  private async useApproval(
    tx: Transaction,
    caller: Caller,
    draft: BillDraft,
    input: Parameters<typeof discountShares>[0],
    now: Date,
  ): Promise<string | null> {
    const [user] = await tx
      .select({ stored: users.discountLimitBasisPoints })
      .from(users)
      .where(eq(users.id, caller.userId));
    const limit = effectiveDiscountLimit(caller.role, caller.permissions, user?.stored ?? null);
    if (discountWithinLimit(input, limit)) return null;
    const shares = discountShares(input);
    if (draft.approvalId === undefined) {
      throw new ForbiddenException({ code: 'approval_required', ...shares });
    }
    const [used] = await tx
      .update(ownerApprovals)
      .set({ usedAt: now })
      .where(
        and(
          eq(ownerApprovals.id, draft.approvalId),
          eq(ownerApprovals.branchId, caller.branchId),
          eq(ownerApprovals.billKey, draft.billKey),
          eq(ownerApprovals.kind, 'discount'),
          isNull(ownerApprovals.usedAt),
          sql`${ownerApprovals.expiresAt} > ${now}`,
          sql`${ownerApprovals.lineBasisPoints} >= ${shares.lineBasisPoints}`,
          sql`${ownerApprovals.billBasisPoints} >= ${shares.billBasisPoints}`,
        ),
      )
      .returning({ id: ownerApprovals.id });
    if (used === undefined) throw new ConflictException({ code: 'approval_invalid' });
    return used.id;
  }

  /**
   * The owner's OK for this bill's udhaar, used up here when the draft carries one (the bill is
   * then linked to it): its own approval, apart from a discount's (`03` #18). Null when there is no
   * udhaar or no OK. Whether the OK is needed is decided once the balance is locked.
   */
  private async useCreditApproval(
    tx: Transaction,
    caller: Caller,
    draft: BillDraft,
    udhaarPaise: number,
    now: Date,
  ): Promise<string | null> {
    if (draft.creditApprovalId === undefined || udhaarPaise === 0) return null;
    const [used] = await tx
      .update(ownerApprovals)
      .set({ usedAt: now })
      .where(
        and(
          eq(ownerApprovals.id, draft.creditApprovalId),
          eq(ownerApprovals.branchId, caller.branchId),
          eq(ownerApprovals.billKey, draft.billKey),
          eq(ownerApprovals.kind, 'credit_limit'),
          isNull(ownerApprovals.usedAt),
          sql`${ownerApprovals.expiresAt} > ${now}`,
          sql`${ownerApprovals.amountPaise} >= ${udhaarPaise}`,
        ),
      )
      .returning({ id: ownerApprovals.id });
    if (used === undefined) throw new ConflictException({ code: 'approval_invalid' });
    return used.id;
  }

  /**
   * The bill's entries in the customer's ledger: the advance used, then the udhaar given, once the
   * limit allows it. Returns the balance after, or null when the bill touches no account.
   */
  private async moveLedger(
    tx: Transaction,
    caller: Caller,
    bill: {
      customerId: string | null;
      billId: string;
      businessDate: string;
      udhaarPaise: number;
      advancePaise: number;
      limitPaise: number | null;
      setting: OverCreditLimitSetting;
      approved: boolean;
    },
  ): Promise<number | null> {
    const { customerId, billId, udhaarPaise, advancePaise } = bill;
    if (customerId === null || (udhaarPaise === 0 && advancePaise === 0)) return null;
    const entry = {
      customerId,
      billId,
      branchId: caller.branchId,
      actorId: caller.userId,
      businessDate: bill.businessDate,
    };
    try {
      let balance: number;
      if (advancePaise > 0) {
        const used = await moveUdhaar(tx, {
          ...entry,
          kind: 'advance_used',
          amountPaise: advancePaise,
        });
        balance = used.balanceAfterPaise;
      } else {
        balance = await lockUdhaarAccount(tx, customerId);
      }
      if (udhaarPaise === 0) return balance;
      const verdict = creditLimitVerdict({
        who: caller.role,
        setting: bill.setting,
        limitPaise: bill.limitPaise,
        balanceAfterPaise: balance + udhaarPaise,
      });
      if (verdict === 'needs_approval' && !bill.approved) {
        throw new ConflictException({
          code: 'over_credit_limit',
          balancePaise: balance,
          limitPaise: bill.limitPaise,
        });
      }
      const given = await moveUdhaar(tx, { ...entry, kind: 'bill', amountPaise: udhaarPaise });
      return given.balanceAfterPaise;
    } catch (error) {
      if (error instanceof UdhaarRuleError && error.code === 'advance_changed') {
        throw new ConflictException({
          code: 'advance_changed',
          availablePaise: error.availablePaise,
        });
      }
      throw error;
    }
  }

  /** The save's answer, read back from what was stored, so a retry gets the same. */
  private async view(tx: Transaction, billId: string): Promise<SavedBillView> {
    const [bill] = await tx
      .select({
        id: bills.id,
        number: bills.number,
        document: bills.document,
        businessDate: bills.businessDate,
        grandTotalPaise: bills.grandTotalPaise,
      })
      .from(bills)
      .where(eq(bills.id, billId));
    if (bill === undefined) throw new Error(`Bill ${billId} not found`);
    const payments = await tx
      .select({ amountPaise: billPayments.amountPaise, tenderedPaise: billPayments.tenderedPaise })
      .from(billPayments)
      .where(eq(billPayments.billId, billId));
    // Under `warn` a sale can end below zero; under `block` it never does.
    const below = await tx
      .select({ itemId: stockMovements.itemId, balanceAfter: stockMovements.balanceAfter })
      .from(stockMovements)
      .where(and(eq(stockMovements.billId, billId), sql`${stockMovements.balanceAfter} < 0`))
      .orderBy(asc(stockMovements.id));
    // Udhaar this bill put past the customer's credit limit, for the owner's warning (`03` #9).
    const [credit] = await tx
      .select({
        balanceAfterPaise: udhaarEntries.balanceAfterPaise,
        limitPaise: customers.creditLimitPaise,
      })
      .from(udhaarEntries)
      .innerJoin(customers, eq(customers.id, udhaarEntries.customerId))
      .where(and(eq(udhaarEntries.billId, billId), eq(udhaarEntries.kind, 'bill')));
    const warnings = new Map(below.map((line) => [line.itemId, line.balanceAfter]));
    return {
      ...bill,
      document: bill.document as BillDocument,
      changePaise: payments.reduce(
        (sum, payment) =>
          sum + (payment.tenderedPaise === null ? 0 : payment.tenderedPaise - payment.amountPaise),
        0,
      ),
      warnings: [...warnings].map(([itemId, balanceAfter]) => ({ itemId, balanceAfter })),
      creditWarning:
        credit?.limitPaise != null && credit.balanceAfterPaise > credit.limitPaise
          ? { balanceAfterPaise: credit.balanceAfterPaise, limitPaise: credit.limitPaise }
          : null,
    };
  }
}
