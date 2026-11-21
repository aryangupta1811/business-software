import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  isNull,
  itemBarcodes,
  itemBranchLevels,
  items,
  itemStock,
  itemUnits,
  ownerApprovals,
  recordEntry,
  sql,
  units,
  users,
  type Database,
  type SQL,
  type Transaction,
} from '@business-software/db';
import {
  APPROVAL_MINUTES,
  type ApprovalInput,
  type ApprovalView,
  type BuiltInUnit,
  type CatalogueBarcode,
  type CatalogueEntry,
  type CataloguePack,
  type CatalogueQuery,
  type CatalogueStock,
  type CatalogueView,
  type DiscardBillInput,
  type ItemKind,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import { inBusiness } from '../items/conflicts.js';
import { discardedEntry } from './held-bills.service.js';
import type { Caller } from '../http/session.js';

/** Appends `value` to the list kept for `key`. */
function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** The billing counter (P1.13, design `docs/plans/2026-11-20-p1.13-billing-design.md`). */
@Injectable()
export class BillingService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  /**
   * The counter's copy of the catalogue (design §4, ADR 0043): every item, or only those changed
   * at or after `since`. Never the purchase price. Stock at the caller's branch only with
   * `stock.view`. The screen asks for changes since 60 s before the last `serverTime`, because a
   * change is stamped when it's made and seen only when its transaction commits.
   */
  catalogue(caller: Caller, query: CatalogueQuery): Promise<CatalogueView> {
    // Taken before reading: anything this read can't see yet is stamped at most a transaction's
    // lifetime before it, which the next sync's overlap covers.
    const serverTime = this.clock.now();
    const since = query.since === undefined ? null : new Date(query.since);
    const changed = since === null ? undefined : sql`${items.updatedAt} >= ${since}`;
    return inBusiness(this.database, caller, async (tx) => {
      const [rows, packs, codes] = await Promise.all([
        tx.select().from(items).where(changed).orderBy(asc(items.name), asc(items.id)),
        this.packs(tx, changed),
        this.barcodes(tx, changed),
      ]);
      const entries = rows.map((item): CatalogueEntry => {
        const barcodes = codes.get(item.id) ?? [];
        if (item.archivedAt !== null) {
          return { id: item.id, archived: true, name: item.name, barcodes };
        }
        return {
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
          packs: packs.get(item.id) ?? [],
          barcodes,
        };
      });
      const stock = caller.permissions.includes('stock.view')
        ? await this.stock(tx, caller.branchId, since)
        : null;
      return { items: entries, stock, serverTime: serverTime.toISOString() };
    });
  }

  /**
   * A full open bill cleared without saving (`Alt+N`, question 7): nothing is stored but the log
   * entry, so money taken for a bill that was then thrown away shows up in the log.
   */
  discard(caller: Caller, input: DiscardBillInput): Promise<{ billKey: string }> {
    return inBusiness(this.database, caller, async (tx) => {
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'bill.draft_discarded',
        entityType: 'bill',
        entityId: input.draft.billKey,
        branchId: caller.branchId,
        after: discardedEntry(input.draft, input.shownTotalPaise, null),
      });
      return { billKey: input.draft.billKey };
    });
  }

  /**
   * The owner's OK for discounts above a cashier's limit on one bill (design §6, question 5):
   * the owner types their password at the counter. Kept for 30 minutes, used up by the save
   * (P1.14), logged at once. The password is checked under its rate limit and never stored.
   */
  async approve(caller: Caller, input: ApprovalInput): Promise<ApprovalView> {
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + APPROVAL_MINUTES * 60_000);
    return inBusiness(this.database, caller, async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'owner'));
      if (owner === undefined) throw new Error('Business has no owner');
      const [row] = await tx
        .insert(ownerApprovals)
        .values({
          branchId: caller.branchId,
          billKey: input.billKey,
          kind: input.kind,
          lineBasisPoints: input.lineBasisPoints,
          billBasisPoints: input.billBasisPoints,
          requestedBy: caller.userId,
          approvedBy: owner.id,
          expiresAt,
          createdAt: now,
        })
        .returning({ id: ownerApprovals.id });
      if (row === undefined) throw new Error('No approval row returned');
      const view = { approvalId: row.id, expiresAt: expiresAt.toISOString() };
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'discount.approved',
        entityType: 'owner_approval',
        entityId: row.id,
        branchId: caller.branchId,
        after: {
          billKey: input.billKey,
          kind: input.kind,
          lineBasisPoints: input.lineBasisPoints,
          billBasisPoints: input.billBasisPoints,
          approvedBy: owner.id,
          expiresAt: view.expiresAt,
        },
      });
      return view;
    });
  }

  private async packs(
    tx: Transaction,
    changed: SQL | undefined,
  ): Promise<Map<string, CataloguePack[]>> {
    // Fine to read packs of archived items too: they're dropped with the slim entry.
    const rows = await tx
      .select({ pack: itemUnits, unitName: units.name })
      .from(itemUnits)
      .innerJoin(items, eq(items.id, itemUnits.itemId))
      .leftJoin(units, eq(units.id, itemUnits.unitId))
      .where(and(isNull(itemUnits.archivedAt), changed))
      .orderBy(asc(itemUnits.id));
    const byItem = new Map<string, CataloguePack[]>();
    for (const { pack, unitName } of rows) {
      pushTo(byItem, pack.itemId, {
        id: pack.id,
        unitCode: pack.unitCode as BuiltInUnit | null,
        unitName,
        size: pack.size,
        sellingPrice: pack.sellingPrice,
        mrp: pack.mrp,
        soldAsPack: pack.soldAsPack,
      });
    }
    return byItem;
  }

  private async barcodes(
    tx: Transaction,
    changed: SQL | undefined,
  ): Promise<Map<string, CatalogueBarcode[]>> {
    const rows = await tx
      .select({
        itemId: itemBarcodes.itemId,
        code: itemBarcodes.code,
        packId: itemBarcodes.itemUnitId,
      })
      .from(itemBarcodes)
      .innerJoin(items, eq(items.id, itemBarcodes.itemId))
      .where(and(isNull(itemBarcodes.removedAt), changed))
      .orderBy(asc(itemBarcodes.id));
    const byItem = new Map<string, CatalogueBarcode[]>();
    for (const { itemId, code, packId } of rows) pushTo(byItem, itemId, { code, packId });
    return byItem;
  }

  /**
   * Live goods' stock at one branch: for every item changed since `since` (its level is saved
   * with the item) and every item whose stock moved since then. No stock row yet means 0.
   */
  private async stock(
    tx: Transaction,
    branchId: string,
    since: Date | null,
  ): Promise<CatalogueStock[]> {
    const changed =
      since === null
        ? undefined
        : sql`(${items.updatedAt} >= ${since} or ${itemStock.updatedAt} >= ${since})`;
    const rows = await tx
      .select({
        itemId: items.id,
        quantity: itemStock.quantity,
        lowStockLevel: itemBranchLevels.lowStockLevel,
      })
      .from(items)
      .leftJoin(itemStock, and(eq(itemStock.itemId, items.id), eq(itemStock.branchId, branchId)))
      .leftJoin(
        itemBranchLevels,
        and(eq(itemBranchLevels.itemId, items.id), eq(itemBranchLevels.branchId, branchId)),
      )
      .where(and(eq(items.kind, 'goods'), isNull(items.archivedAt), changed))
      .orderBy(asc(items.id));
    return rows.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity ?? 0,
      lowStockLevel: row.lowStockLevel,
    }));
  }
}
