import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  categories,
  eq,
  inArray,
  isNull,
  items,
  itemUnits,
  recordEntry,
  sql,
  units,
  type Database,
  type EntryAction,
  type Transaction,
} from '@business-software/db';
import type {
  BuiltInUnit,
  CategoryInput,
  CategoryView,
  UnitInput,
  UnitView,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { changes, inBusiness } from './conflicts.js';

type Category = typeof categories.$inferSelect;
type Unit = typeof units.$inferSelect;

const categoryView = (row: Category): CategoryView => ({
  id: row.id,
  name: row.name,
  archived: row.archivedAt !== null,
});

const unitView = (row: Unit): UnitView => ({
  id: row.id,
  name: row.name,
  hindiName: row.hindiName,
  baseUnit: row.baseUnit as BuiltInUnit,
  defaultSize: row.defaultSize,
  archived: row.archivedAt !== null,
});

/**
 * The owner's categories (Module 00 #4: none pre-loaded) and own units (Module 01 #16). Names
 * are unique among live rows, case ignored (409 name_taken); archiving frees a name, and
 * nothing is deleted (ADR 0007).
 */
@Injectable()
export class CatalogueService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  listCategories(caller: Caller): Promise<CategoryView[]> {
    return inBusiness(this.database, caller, async (tx) =>
      (
        await tx
          .select()
          .from(categories)
          .orderBy(sql`${categories.name} collate item_name`, asc(categories.id))
      ).map(categoryView),
    );
  }

  createCategory(caller: Caller, input: CategoryInput): Promise<CategoryView> {
    return inBusiness(this.database, caller, async (tx) => {
      const row = only(await tx.insert(categories).values({ name: input.name }).returning());
      await log(tx, caller, 'category', 'category.created', row.id, { after: { name: row.name } });
      return categoryView(row);
    });
  }

  updateCategory(caller: Caller, id: string, input: CategoryInput): Promise<CategoryView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await lockCategory(tx, id);
      const changed = changes({ name: current.name }, { name: input.name });
      if (changed === null) return categoryView(current);
      const row = only(
        await tx
          .update(categories)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .returning(),
      );
      await log(tx, caller, 'category', 'category.updated', id, changed);
      return categoryView(row);
    });
  }

  setCategoryArchived(caller: Caller, id: string, archive: boolean): Promise<CategoryView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await lockCategory(tx, id);
      if ((current.archivedAt !== null) === archive) return categoryView(current);
      const row = only(
        await tx
          .update(categories)
          .set(archivedState(archive))
          .where(eq(categories.id, id))
          .returning(),
      );
      await log(tx, caller, 'category', archive ? 'category.archived' : 'category.restored', id);
      return categoryView(row);
    });
  }

  listUnits(caller: Caller): Promise<UnitView[]> {
    return inBusiness(this.database, caller, async (tx) =>
      (
        await tx
          .select()
          .from(units)
          .orderBy(sql`${units.name} collate item_name`, asc(units.id))
      ).map(unitView),
    );
  }

  createUnit(caller: Caller, input: UnitInput): Promise<UnitView> {
    return inBusiness(this.database, caller, async (tx) => {
      const row = only(await tx.insert(units).values(input).returning());
      await log(tx, caller, 'unit', 'unit.created', row.id, { after: { ...input } });
      return unitView(row);
    });
  }

  updateUnit(caller: Caller, id: string, input: UnitInput): Promise<UnitView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await lockUnit(tx, id);
      const before = {
        name: current.name,
        hindiName: current.hindiName,
        baseUnit: current.baseUnit,
        defaultSize: current.defaultSize,
      };
      const changed = changes(before, { ...input });
      if (changed === null) return unitView(current);
      const row = only(
        await tx
          .update(units)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(units.id, id))
          .returning(),
      );
      await touchItemsUsing(tx, id);
      await log(tx, caller, 'unit', 'unit.updated', id, changed);
      return unitView(row);
    });
  }

  setUnitArchived(caller: Caller, id: string, archive: boolean): Promise<UnitView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await lockUnit(tx, id);
      if ((current.archivedAt !== null) === archive) return unitView(current);
      const row = only(
        await tx.update(units).set(archivedState(archive)).where(eq(units.id, id)).returning(),
      );
      await touchItemsUsing(tx, id);
      await log(tx, caller, 'unit', archive ? 'unit.archived' : 'unit.restored', id);
      return unitView(row);
    });
  }
}

/** The one row a write returned; none would be a bug, not the visitor's mistake. */
function only<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('No row returned');
  return row;
}

const archivedState = (archive: boolean) => ({
  archivedAt: archive ? new Date() : null,
  updatedAt: new Date(),
});

async function lockCategory(tx: Transaction, id: string): Promise<Category> {
  const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
  if (row === undefined) throw new NotFoundException({ code: 'not_found' });
  return row;
}

async function lockUnit(tx: Transaction, id: string): Promise<Unit> {
  const [row] = await tx.select().from(units).where(eq(units.id, id)).for('update');
  if (row === undefined) throw new NotFoundException({ code: 'not_found' });
  return row;
}

/**
 * Each pack shows its unit's name, so items with a live pack in this unit read differently
 * after a rename or archive. They count as changed for P1.13's "changed since" sync.
 */
async function touchItemsUsing(tx: Transaction, unitId: string): Promise<void> {
  const using = tx
    .select({ id: itemUnits.itemId })
    .from(itemUnits)
    .where(and(eq(itemUnits.unitId, unitId), isNull(itemUnits.archivedAt)));
  await tx.update(items).set({ updatedAt: new Date() }).where(inArray(items.id, using));
}

function log(
  tx: Transaction,
  caller: Caller,
  entityType: 'category' | 'unit',
  action: EntryAction,
  entityId: string,
  detail: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
): Promise<void> {
  return recordEntry(tx, { actorId: caller.userId, action, entityType, entityId, ...detail });
}
