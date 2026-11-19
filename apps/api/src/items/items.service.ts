import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  branches,
  businesses,
  categories,
  eq,
  inArray,
  isNotNull,
  isNull,
  itemBarcodes,
  itemBranchLevels,
  items,
  itemUnits,
  recordEntry,
  sql,
  units,
  withBusiness,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  inStoreBarcode,
  inStoreSerial,
  type BarcodeInput,
  type BarcodeMatch,
  type BuiltInUnit,
  type FieldErrors,
  type ItemKind,
  type ItemPage,
  type ItemQuery,
  type ItemRow,
  type ItemUpdateInput,
  type ItemView,
  type NewItemInput,
  type PackInput,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { answerConflicts, changes } from './conflicts.js';

const PAGE_SIZE = 50;

type ItemFields = Omit<NewItemInput, 'barcodes'>;
type ItemRecord = typeof items.$inferSelect;

/** Module 01 #1: the purchase price is hidden from staff unless the owner allows it. */
const seesCost = (caller: Caller) => caller.permissions.includes('items.view_cost');

/** The view without the purchase price for a caller who may not see it (the key is absent). */
function forCaller<T extends { purchasePrice?: number | null }>(view: T, caller: Caller): T {
  if (seesCost(caller)) return view;
  const copy = { ...view };
  delete copy.purchasePrice;
  return copy;
}

/** What the entry log records about an item: every field the owner edits, cost included. */
function logged(view: ItemView): Record<string, unknown> {
  const hidden = new Set(['id', 'version', 'archived', 'barcodes']);
  return Object.fromEntries(Object.entries(view).filter(([key]) => !hidden.has(key)));
}

/** `%`, `_` and `\` typed in a search are letters, not patterns. */
const escapeLike = (term: string) => term.replace(/[\\%_]/g, (character) => `\\${character}`);

interface Cursor {
  rank: number;
  name: string;
  id: string;
}

const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify([cursor.rank, cursor.name, cursor.id])).toString('base64url');

function decodeCursor(after: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      Number.isInteger(value[0]) &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[2])
    ) {
      return { rank: value[0] as number, name: value[1], id: value[2] };
    }
  } catch {
    // Not base64url JSON: answered below.
  }
  throw new BadRequestException({ code: 'invalid_body', fields: { after: 'invalid' } });
}

const invalid = (fields: FieldErrors) => new BadRequestException({ code: 'invalid_body', fields });

/**
 * Items (P1.7, Module 01 #1–3, #8, #16). Every change is one transaction with one entry log
 * row holding only what changed (ADR 0028); nothing is deleted (ADR 0007).
 */
@Injectable()
export class ItemsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  private inBusiness<T>(caller: Caller, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return answerConflicts(withBusiness(this.database.db, caller.businessId, work));
  }

  // ---- Reading ----

  list(caller: Caller, query: ItemQuery): Promise<ItemPage> {
    return this.inBusiness(caller, async (tx) => {
      const term = query.q ?? null;
      const exactCode = term === null ? sql`false` : sql`lower(${items.code}) = lower(${term})`;
      const exactBarcode =
        term === null
          ? sql`false`
          : sql`exists (select 1 from ${itemBarcodes}
              where ${itemBarcodes.itemId} = ${items.id} and ${itemBarcodes.code} = ${term}
                and ${itemBarcodes.removedAt} is null)`;
      // Exact code or barcode first, then names that start with the term, then the rest.
      const rank =
        term === null
          ? sql<number>`0::int` // a bare 0 in ORDER BY would mean "column 0"
          : sql<number>`case when ${exactCode} or ${exactBarcode} then 0
              when ${items.name} ilike ${`${escapeLike(term)}%`} then 1 else 2 end`;
      const conditions = [
        query.archived === 'true' ? isNotNull(items.archivedAt) : isNull(items.archivedAt),
      ];
      if (query.category !== undefined) conditions.push(eq(items.categoryId, query.category));
      if (term !== null) {
        const like = `%${escapeLike(term)}%`;
        conditions.push(
          sql`(${exactCode} or ${exactBarcode} or ${items.name} ilike ${like}
            or ${items.hindiName} ilike ${like} or ${items.brand} ilike ${like})`,
        );
      }
      if (query.after !== undefined) {
        const cursor = decodeCursor(query.after);
        conditions.push(
          sql`(${rank}, ${items.name} collate item_name, ${items.id})
            > (${cursor.rank}::int, ${cursor.name}::text collate item_name, ${cursor.id}::uuid)`,
        );
      }
      const rows = await tx
        .select({ item: items, rank })
        .from(items)
        .where(and(...conditions))
        .orderBy(rank, sql`${items.name} collate item_name`, asc(items.id))
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      return {
        items: page.map(({ item }) => forCaller(toRow(item), caller)),
        next:
          rows.length > PAGE_SIZE && last !== undefined
            ? encodeCursor({ rank: last.rank, name: last.item.name, id: last.item.id })
            : null,
      };
    });
  }

  read(caller: Caller, id: string): Promise<ItemView> {
    return this.inBusiness(caller, async (tx) => forCaller(await this.mustLoad(tx, id), caller));
  }

  /** A scan (#8): the item the code is on, archived ones included, so the screen can offer a restore. */
  byBarcode(caller: Caller, code: string): Promise<BarcodeMatch> {
    return this.inBusiness(caller, async (tx) => {
      const [found] = await tx
        .select({ itemId: itemBarcodes.itemId, packId: itemBarcodes.itemUnitId })
        .from(itemBarcodes)
        .where(and(eq(itemBarcodes.code, code), isNull(itemBarcodes.removedAt)));
      if (found === undefined) throw new NotFoundException({ code: 'unknown_barcode' });
      return {
        item: forCaller(await this.mustLoad(tx, found.itemId), caller),
        packId: found.packId,
      };
    });
  }

  // ---- Changing ----

  create(caller: Caller, input: NewItemInput): Promise<ItemView> {
    this.checkCost(caller, input);
    return this.inBusiness(caller, async (tx) => {
      await this.checkReferences(tx, input, null);
      await this.checkBarcodesFree(tx, input.barcodes);
      const [row] = await tx
        .insert(items)
        .values({ ...columns(input), purchasePrice: input.purchasePrice ?? null })
        .returning({ id: items.id });
      if (row === undefined) throw new Error('No item row returned');
      await this.writePacks(tx, row.id, input.packs, []);
      await this.writeLevels(tx, row.id, input.levels, []);
      for (const code of input.barcodes) {
        await tx
          .insert(itemBarcodes)
          .values({ itemId: row.id, code, inStore: inStoreSerial(code) !== null });
      }
      const view = await this.mustLoad(tx, row.id);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'item.created',
        entityType: 'item',
        entityId: row.id,
        after: { ...logged(view), barcodes: input.barcodes },
      });
      return forCaller(view, caller);
    });
  }

  /** The whole item, saved from the copy at `version`; someone else's newer save wins (409). */
  update(caller: Caller, id: string, input: ItemUpdateInput): Promise<ItemView> {
    this.checkCost(caller, input);
    return this.inBusiness(caller, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.version !== input.version) throw new ConflictException({ code: 'stale' });
      const before = await this.mustLoad(tx, id);
      const known = new Set(before.packs.map((pack) => pack.id));
      const unknownPack = input.packs.findIndex((pack) => pack.id !== null && !known.has(pack.id));
      if (unknownPack >= 0) throw invalid({ [`packs.${String(unknownPack)}.id`]: 'invalid' });
      await this.checkReferences(tx, input, before);

      const purchasePrice =
        input.purchasePrice === undefined ? current.purchasePrice : input.purchasePrice;
      await tx
        .update(items)
        .set({ ...columns(input), purchasePrice })
        .where(eq(items.id, id));
      await this.writePacks(tx, id, input.packs, before.packs);
      await this.writeLevels(tx, id, input.levels, before.levels);

      const after = await this.mustLoad(tx, id);
      const changed = changes(logged(before), logged(after));
      if (changed === null) return forCaller(before, caller);
      await tx
        .update(items)
        .set({ version: sql`${items.version} + 1`, updatedAt: new Date() })
        .where(eq(items.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'item.updated',
        entityType: 'item',
        entityId: id,
        ...changed,
      });
      return forCaller(await this.mustLoad(tx, id), caller);
    });
  }

  archive(caller: Caller, id: string): Promise<ItemView> {
    return this.setArchived(caller, id, true);
  }

  /** Restoring checks the name and short code are still free (409 name_taken, code_taken). */
  restore(caller: Caller, id: string): Promise<ItemView> {
    return this.setArchived(caller, id, false);
  }

  /** A code for the item or one of its packs; a null code makes the next in-store one (#8). */
  addBarcode(caller: Caller, itemId: string, input: BarcodeInput): Promise<ItemView> {
    return this.inBusiness(caller, async (tx) => {
      await this.lock(tx, itemId);
      if (input.packId !== null) {
        const [pack] = await tx
          .select({ id: itemUnits.id })
          .from(itemUnits)
          .where(
            and(
              eq(itemUnits.id, input.packId),
              eq(itemUnits.itemId, itemId),
              isNull(itemUnits.archivedAt),
            ),
          );
        if (pack === undefined) throw invalid({ packId: 'invalid' });
      }
      const code = input.code ?? (await this.nextInStoreCode(tx));
      if (input.code !== null) await this.checkBarcodesFree(tx, [code]);
      await tx
        .insert(itemBarcodes)
        .values({ itemId, itemUnitId: input.packId, code, inStore: inStoreSerial(code) !== null });
      // The browser's copy of the catalogue (P1.13) asks for what changed since.
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, itemId));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'item.barcode_added',
        entityType: 'item',
        entityId: itemId,
        after: { code, packId: input.packId },
      });
      return forCaller(await this.mustLoad(tx, itemId), caller);
    });
  }

  removeBarcode(caller: Caller, itemId: string, barcodeId: string): Promise<ItemView> {
    return this.inBusiness(caller, async (tx) => {
      const [removed] = await tx
        .update(itemBarcodes)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(itemBarcodes.id, barcodeId),
            eq(itemBarcodes.itemId, itemId),
            isNull(itemBarcodes.removedAt),
          ),
        )
        .returning({ code: itemBarcodes.code, packId: itemBarcodes.itemUnitId });
      if (removed === undefined) throw new NotFoundException({ code: 'not_found' });
      await tx.update(items).set({ updatedAt: new Date() }).where(eq(items.id, itemId));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'item.barcode_removed',
        entityType: 'item',
        entityId: itemId,
        before: removed,
      });
      return forCaller(await this.mustLoad(tx, itemId), caller);
    });
  }

  // ---- Helpers ----

  private checkCost(caller: Caller, input: { purchasePrice?: number | null | undefined }): void {
    if (!seesCost(caller) && input.purchasePrice !== undefined) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
  }

  /** The item's row, locked for this transaction; 404 if there is none, 409 if it's archived. */
  private async lock(tx: Transaction, id: string): Promise<ItemRecord> {
    const [row] = await tx.select().from(items).where(eq(items.id, id)).for('update');
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    if (row.archivedAt !== null) throw new ConflictException({ code: 'archived' });
    return row;
  }

  private setArchived(caller: Caller, id: string, archive: boolean): Promise<ItemView> {
    return this.inBusiness(caller, async (tx) => {
      const [row] = await tx.select().from(items).where(eq(items.id, id)).for('update');
      if (row === undefined) throw new NotFoundException({ code: 'not_found' });
      // Already as asked: nothing to change or log.
      if ((row.archivedAt !== null) === archive)
        return forCaller(await this.mustLoad(tx, id), caller);
      await tx
        .update(items)
        .set({
          archivedAt: archive ? new Date() : null,
          version: sql`${items.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(items.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: archive ? 'item.archived' : 'item.restored',
        entityType: 'item',
        entityId: id,
        before: { archived: !archive },
        after: { archived: archive },
      });
      return forCaller(await this.mustLoad(tx, id), caller);
    });
  }

  /**
   * Checks what the shared schema can't see: G5 (a regular business's items need a GST rate
   * and HSN), and that the category, own units and branches are this business's and live.
   * RLS hides other businesses' rows, so "not found" covers them too.
   */
  private async checkReferences(
    tx: Transaction,
    input: ItemFields,
    before: ItemView | null,
  ): Promise<void> {
    const errors: FieldErrors = {};
    const [business] = await tx.select({ gstStatus: businesses.gstStatus }).from(businesses);
    if (business?.gstStatus === 'regular') {
      if (input.gstRate === null) errors.gstRate = 'required';
      if (input.hsn === null) errors.hsn = 'required';
    }

    // An archived category or unit may stay where it already is, but not be newly chosen.
    if (input.categoryId !== null && input.categoryId !== before?.categoryId) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), isNull(categories.archivedAt)));
      if (category === undefined) errors.categoryId = 'invalid';
    }

    const kept = new Map(before?.packs.map((pack) => [pack.id, pack.unitId]) ?? []);
    const unitIds = input.packs.flatMap((pack) =>
      pack.unitId !== null && (pack.id === null || kept.get(pack.id) !== pack.unitId)
        ? [pack.unitId]
        : [],
    );
    const liveUnits = new Set(
      unitIds.length === 0
        ? []
        : (
            await tx
              .select({ id: units.id })
              .from(units)
              .where(and(inArray(units.id, unitIds), isNull(units.archivedAt)))
          ).map((row) => row.id),
    );
    input.packs.forEach((pack, index) => {
      if (unitIds.includes(pack.unitId ?? '') && !liveUnits.has(pack.unitId ?? '')) {
        errors[`packs.${String(index)}.unitId`] = 'invalid';
      }
    });

    const branchIds = input.levels.map((level) => level.branchId);
    const ownBranches = new Set(
      branchIds.length === 0
        ? []
        : (
            await tx
              .select({ id: branches.id })
              .from(branches)
              .where(inArray(branches.id, branchIds))
          ).map((row) => row.id),
    );
    input.levels.forEach((level, index) => {
      if (!ownBranches.has(level.branchId)) {
        errors[`levels.${String(index)}.branchId`] = 'invalid';
      }
    });

    if (Object.keys(errors).length > 0) throw invalid(errors);
  }

  /** 409 naming the item that already has the code, so the owner knows where to look. */
  private async checkBarcodesFree(tx: Transaction, codes: readonly string[]): Promise<void> {
    if (codes.length === 0) return;
    const [taken] = await tx
      .select({ code: itemBarcodes.code, itemName: items.name })
      .from(itemBarcodes)
      .innerJoin(items, eq(items.id, itemBarcodes.itemId))
      .where(and(inArray(itemBarcodes.code, [...codes]), isNull(itemBarcodes.removedAt)));
    if (taken !== undefined) {
      throw new ConflictException({
        code: 'barcode_taken',
        barcode: taken.code,
        itemName: taken.itemName,
      });
    }
  }

  /**
   * The next in-store code: one more than the highest ever made, removed ones included, so a
   * label printed long ago never scans as a different item. The lock on the business row
   * makes two counters asking at once take turns (two different codes).
   */
  private async nextInStoreCode(tx: Transaction): Promise<string> {
    await tx.select({ id: businesses.id }).from(businesses).for('update');
    const [highest] = await tx
      .select({ code: sql<string | null>`max(${itemBarcodes.code})` })
      .from(itemBarcodes)
      .where(eq(itemBarcodes.inStore, true));
    const last = highest?.code === null || highest === undefined ? 0 : inStoreSerial(highest.code);
    return inStoreBarcode((last ?? 0) + 1);
  }

  /**
   * Packs not sent any more are archived, with their barcodes removed; sent ones are updated;
   * new ones (no id) are added. In that order, so a unit can move from an old pack to a new one.
   */
  private async writePacks(
    tx: Transaction,
    itemId: string,
    packs: readonly PackInput[],
    existing: ItemView['packs'],
  ): Promise<void> {
    const sent = new Set(packs.flatMap((pack) => (pack.id === null ? [] : [pack.id])));
    const dropped = existing.filter((pack) => !sent.has(pack.id)).map((pack) => pack.id);
    if (dropped.length > 0) {
      const now = new Date();
      await tx
        .update(itemUnits)
        .set({ archivedAt: now, updatedAt: now })
        .where(inArray(itemUnits.id, dropped));
      await tx
        .update(itemBarcodes)
        .set({ removedAt: now })
        .where(and(inArray(itemBarcodes.itemUnitId, dropped), isNull(itemBarcodes.removedAt)));
    }
    for (const pack of packs) {
      const values = {
        unitCode: pack.unitCode,
        unitId: pack.unitId,
        size: pack.size,
        sellingPrice: pack.sellingPrice,
        mrp: pack.mrp,
        soldAsPack: pack.soldAsPack,
        boughtAsPack: pack.boughtAsPack,
      };
      if (pack.id === null) {
        await tx.insert(itemUnits).values({ ...values, itemId });
      } else {
        await tx
          .update(itemUnits)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(itemUnits.id, pack.id));
      }
    }
  }

  /** One level per branch sent; a branch not sent any more goes back to 0 (no alert). */
  private async writeLevels(
    tx: Transaction,
    itemId: string,
    levels: NewItemInput['levels'],
    existing: ItemView['levels'],
  ): Promise<void> {
    const sent = new Set(levels.map((level) => level.branchId));
    const all = [
      ...levels,
      ...existing
        .filter((level) => !sent.has(level.branchId) && level.lowStockLevel !== 0)
        .map((level) => ({ branchId: level.branchId, lowStockLevel: 0 })),
    ];
    for (const level of all) {
      await tx
        .insert(itemBranchLevels)
        .values({ itemId, branchId: level.branchId, lowStockLevel: level.lowStockLevel })
        .onConflictDoUpdate({
          target: [itemBranchLevels.businessId, itemBranchLevels.itemId, itemBranchLevels.branchId],
          set: { lowStockLevel: level.lowStockLevel, updatedAt: new Date() },
          setWhere: sql`${itemBranchLevels.lowStockLevel} <> ${level.lowStockLevel}`,
        });
    }
  }

  private async mustLoad(tx: Transaction, id: string): Promise<ItemView> {
    const [item] = await tx.select().from(items).where(eq(items.id, id));
    if (item === undefined) throw new NotFoundException({ code: 'not_found' });
    const packs = await tx
      .select({ pack: itemUnits, unitName: units.name })
      .from(itemUnits)
      .leftJoin(units, eq(units.id, itemUnits.unitId))
      .where(and(eq(itemUnits.itemId, id), isNull(itemUnits.archivedAt)))
      .orderBy(asc(itemUnits.id));
    const codes = await tx
      .select()
      .from(itemBarcodes)
      .where(and(eq(itemBarcodes.itemId, id), isNull(itemBarcodes.removedAt)))
      .orderBy(asc(itemBarcodes.id));
    const levels = await tx
      .select()
      .from(itemBranchLevels)
      .where(eq(itemBranchLevels.itemId, id))
      .orderBy(asc(itemBranchLevels.branchId));
    return {
      ...toRow(item),
      purchasePrice: item.purchasePrice,
      wholesalePrice: item.wholesalePrice,
      priceIncludesTax: item.priceIncludesTax,
      hsn: item.hsn,
      version: item.version,
      packs: packs.map(({ pack, unitName }) => ({
        id: pack.id,
        unitCode: pack.unitCode as BuiltInUnit | null,
        unitId: pack.unitId,
        unitName,
        size: pack.size,
        sellingPrice: pack.sellingPrice,
        mrp: pack.mrp,
        soldAsPack: pack.soldAsPack,
        boughtAsPack: pack.boughtAsPack,
      })),
      barcodes: codes.map((code) => ({
        id: code.id,
        code: code.code,
        packId: code.itemUnitId,
        inStore: code.inStore,
      })),
      levels: levels.map((level) => ({
        branchId: level.branchId,
        lowStockLevel: level.lowStockLevel,
      })),
    };
  }
}

/** The columns an item form sets (the purchase price is handled on its own). */
function columns(input: ItemFields) {
  return {
    kind: input.kind,
    name: input.name,
    hindiName: input.hindiName,
    code: input.code,
    categoryId: input.categoryId,
    brand: input.brand,
    stockUnit: input.stockUnit,
    sellingPrice: input.sellingPrice,
    wholesalePrice: input.wholesalePrice,
    mrp: input.mrp,
    priceIncludesTax: input.priceIncludesTax,
    gstRate: input.gstRate,
    hsn: input.hsn,
  };
}

function toRow(item: ItemRecord): ItemRow {
  return {
    id: item.id,
    kind: item.kind as ItemKind,
    name: item.name,
    hindiName: item.hindiName,
    code: item.code,
    categoryId: item.categoryId,
    brand: item.brand,
    stockUnit: item.stockUnit as BuiltInUnit,
    sellingPrice: item.sellingPrice,
    purchasePrice: item.purchasePrice,
    mrp: item.mrp,
    gstRate: item.gstRate,
    archived: item.archivedAt !== null,
  };
}
