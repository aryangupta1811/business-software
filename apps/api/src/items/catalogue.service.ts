import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  asc,
  categories,
  eq,
  recordEntry,
  sql,
  units,
  withBusiness,
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
import { answerConflicts, changes } from './conflicts.js';

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

  private inBusiness<T>(caller: Caller, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return answerConflicts(withBusiness(this.database.db, caller.businessId, work));
  }

  listCategories(caller: Caller): Promise<CategoryView[]> {
    return this.inBusiness(caller, async (tx) =>
      (
        await tx
          .select()
          .from(categories)
          .orderBy(sql`${categories.name} collate item_name`, asc(categories.id))
      ).map(categoryView),
    );
  }

  createCategory(caller: Caller, input: CategoryInput): Promise<CategoryView> {
    return this.inBusiness(caller, async (tx) => {
      const [row] = await tx.insert(categories).values({ name: input.name }).returning();
      if (row === undefined) throw new Error('No category row returned');
      await this.log(tx, caller, 'category.created', row.id, { after: { name: row.name } });
      return categoryView(row);
    });
  }

  updateCategory(caller: Caller, id: string, input: CategoryInput): Promise<CategoryView> {
    return this.inBusiness(caller, async (tx) => {
      const current = await this.lockCategory(tx, id);
      const changed = changes({ name: current.name }, { name: input.name });
      if (changed === null) return categoryView(current);
      const [row] = await tx
        .update(categories)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning();
      await this.log(tx, caller, 'category.updated', id, changed);
      return categoryView(row ?? current);
    });
  }

  setCategoryArchived(caller: Caller, id: string, archive: boolean): Promise<CategoryView> {
    return this.inBusiness(caller, async (tx) => {
      const current = await this.lockCategory(tx, id);
      if ((current.archivedAt !== null) === archive) return categoryView(current);
      const [row] = await tx
        .update(categories)
        .set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning();
      await this.log(tx, caller, archive ? 'category.archived' : 'category.restored', id, {});
      return categoryView(row ?? current);
    });
  }

  listUnits(caller: Caller): Promise<UnitView[]> {
    return this.inBusiness(caller, async (tx) =>
      (
        await tx
          .select()
          .from(units)
          .orderBy(sql`${units.name} collate item_name`, asc(units.id))
      ).map(unitView),
    );
  }

  createUnit(caller: Caller, input: UnitInput): Promise<UnitView> {
    return this.inBusiness(caller, async (tx) => {
      const [row] = await tx.insert(units).values(input).returning();
      if (row === undefined) throw new Error('No unit row returned');
      await this.log(tx, caller, 'unit.created', row.id, { after: { ...input } });
      return unitView(row);
    });
  }

  updateUnit(caller: Caller, id: string, input: UnitInput): Promise<UnitView> {
    return this.inBusiness(caller, async (tx) => {
      const current = await this.lockUnit(tx, id);
      const before = {
        name: current.name,
        hindiName: current.hindiName,
        baseUnit: current.baseUnit,
        defaultSize: current.defaultSize,
      };
      const changed = changes(before, { ...input });
      if (changed === null) return unitView(current);
      const [row] = await tx
        .update(units)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(units.id, id))
        .returning();
      await this.log(tx, caller, 'unit.updated', id, changed);
      return unitView(row ?? current);
    });
  }

  setUnitArchived(caller: Caller, id: string, archive: boolean): Promise<UnitView> {
    return this.inBusiness(caller, async (tx) => {
      const current = await this.lockUnit(tx, id);
      if ((current.archivedAt !== null) === archive) return unitView(current);
      const [row] = await tx
        .update(units)
        .set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() })
        .where(eq(units.id, id))
        .returning();
      await this.log(tx, caller, archive ? 'unit.archived' : 'unit.restored', id, {});
      return unitView(row ?? current);
    });
  }

  private async lockCategory(tx: Transaction, id: string): Promise<Category> {
    const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    return row;
  }

  private async lockUnit(tx: Transaction, id: string): Promise<Unit> {
    const [row] = await tx.select().from(units).where(eq(units.id, id)).for('update');
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    return row;
  }

  private log(
    tx: Transaction,
    caller: Caller,
    action: EntryAction,
    entityId: string,
    detail: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    return recordEntry(tx, {
      actorId: caller.userId,
      action,
      entityType: action.split('.')[0] ?? 'catalogue',
      entityId,
      ...detail,
    });
  }
}
