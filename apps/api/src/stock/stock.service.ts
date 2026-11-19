import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  branches,
  eq,
  itemBranchLevels,
  items,
  itemStock,
  moveStock,
  recordEntry,
  sql,
  stockMovements,
  StockRuleError,
  users,
  withBusiness,
  type Database,
  type StockLine,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  isLow,
  movementValue,
  type AdjustmentInput,
  type AdjustmentReason,
  type BuiltInUnit,
  type ItemStockView,
  type MovementPage,
  type MovementQuery,
  type MovementView,
  type OpeningStockInput,
  type StockMovementKind,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';

const PAGE_SIZE = 50;

const seesCost = (caller: Caller) => caller.permissions.includes('items.view_cost');

type MovementRecord = typeof stockMovements.$inferSelect;

/** What a retried request must match to be the same request (ADR 0007 rule 7). */
interface Expected {
  itemId: string;
  kind: StockMovementKind;
  quantity: number;
  reason: AdjustmentReason | null;
  note: string | null;
}

/** A rule `moveStock` refused: the answer the screen understands. */
function answerFor(error: StockRuleError): HttpException {
  switch (error.code) {
    case 'not_found':
      return new NotFoundException({ code: 'not_found' });
    case 'invalid':
    case 'whole_units_only':
      return new BadRequestException({ code: 'invalid_body', fields: { quantity: error.code } });
    default:
      return new ConflictException({ code: error.code });
  }
}

/** Drizzle wraps driver errors; PostgreSQL's code and constraint are on `cause`. */
function isKeyTaken(error: unknown): boolean {
  const cause =
    error instanceof Error ? (error.cause as Record<string, unknown> | undefined) : undefined;
  return cause?.code === '23505' && cause.constraint === 'stock_movements_request_key_unique';
}

/**
 * Stock at each branch, opening stock and adjustments (P1.8, Module 01 #4, #9–12). Every change
 * goes through `moveStock` in one transaction with its entry log row (ADRs 0007, 0028).
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private inBusiness<T>(caller: Caller, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withBusiness(this.database.db, caller.businessId, work);
  }

  // ---- Reading ----

  view(caller: Caller, itemId: string): Promise<ItemStockView> {
    return this.inBusiness(caller, async (tx) => {
      const item = await this.goods(tx, itemId);
      const rows = await tx
        .select({
          branchId: branches.id,
          branchName: branches.name,
          quantity: itemStock.quantity,
          averageCost: itemStock.averageCost,
          lastMovementId: itemStock.lastMovementId,
          level: itemBranchLevels.lowStockLevel,
        })
        .from(branches)
        .leftJoin(itemStock, and(eq(itemStock.branchId, branches.id), eq(itemStock.itemId, itemId)))
        .leftJoin(
          itemBranchLevels,
          and(eq(itemBranchLevels.branchId, branches.id), eq(itemBranchLevels.itemId, itemId)),
        )
        .orderBy(sql`${branches.name} collate item_name`, asc(branches.id));
      return {
        itemId,
        stockUnit: item.stockUnit,
        branches: rows.map((row) => {
          const quantity = row.quantity ?? 0;
          const averageCost = row.averageCost ?? null;
          return {
            branchId: row.branchId,
            branchName: row.branchName,
            quantity,
            lowStockLevel: row.level,
            low: isLow(quantity, row.level),
            canOpen: row.lastMovementId === null,
            ...(seesCost(caller) && {
              averageCost,
              value:
                averageCost === null || quantity === 0
                  ? null
                  : movementValue(quantity, averageCost),
            }),
          };
        }),
      };
    });
  }

  movements(caller: Caller, itemId: string, query: MovementQuery): Promise<MovementPage> {
    return this.inBusiness(caller, async (tx) => {
      await this.goods(tx, itemId);
      const conditions = [
        eq(stockMovements.itemId, itemId),
        eq(stockMovements.branchId, query.branch ?? caller.branchId),
      ];
      if (query.after !== undefined) conditions.push(sql`${stockMovements.id} < ${query.after}`);
      // Movements of one item at one branch are written one at a time under its row lock, so
      // their time-ordered ids are in the order they happened.
      const rows = await tx
        .select({ movement: stockMovements, name: users.name, username: users.username })
        .from(stockMovements)
        .innerJoin(users, eq(users.id, stockMovements.actorId))
        .where(and(...conditions))
        .orderBy(sql`${stockMovements.id} desc`)
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      return {
        movements: page.map((row) => this.toView(row.movement, row.name ?? row.username, caller)),
        next: rows.length > PAGE_SIZE ? (page.at(-1)?.movement.id ?? null) : null,
      };
    });
  }

  // ---- Changing ----

  /** Opening stock (#9, owner answer 4A): only while nothing has moved the item at the branch. */
  open(caller: Caller, itemId: string, input: OpeningStockInput): Promise<MovementView> {
    if (input.unitCost !== undefined && !seesCost(caller)) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    const line: StockLine = {
      itemId,
      kind: 'opening',
      quantity: input.quantity,
      ...(input.unitCost !== undefined && { unitCost: input.unitCost }),
    };
    const expected: Expected = {
      itemId,
      kind: 'opening',
      quantity: input.quantity,
      reason: null,
      note: null,
    };
    return this.change(caller, input.requestKey, line, expected, (moved) => ({
      action: 'stock.opening_set',
      after: {
        itemId,
        quantity: moved.quantity,
        unitCost: moved.unitCost,
        value: moved.value,
      },
    }));
  }

  /** An adjustment (#11): never below zero (answer 2A), valued at the average cost (5A). */
  adjust(caller: Caller, itemId: string, input: AdjustmentInput): Promise<MovementView> {
    const line: StockLine = {
      itemId,
      kind: 'adjustment',
      quantity: input.quantity,
      reason: input.reason,
      note: input.note,
    };
    const expected: Expected = {
      itemId,
      kind: 'adjustment',
      quantity: input.quantity,
      reason: input.reason,
      note: input.note,
    };
    return this.change(caller, input.requestKey, line, expected, (moved) => ({
      action: 'stock.adjusted',
      reason: input.note === null ? input.reason : `${input.reason}: ${input.note}`,
      after: {
        itemId,
        quantity: moved.quantity,
        balanceAfter: moved.balanceAfter,
        unitCost: moved.unitCost,
        value: moved.value,
        reasonCode: input.reason,
      },
    }));
  }

  /**
   * One movement with its log row, keyed for retries. A retry finds the first movement and
   * answers it again; two copies arriving together collide on the key's unique index, and the
   * loser answers the winner's movement.
   */
  private async change(
    caller: Caller,
    requestKey: string,
    line: StockLine,
    expected: Expected,
    log: (moved: {
      quantity: number;
      balanceAfter: number;
      unitCost: number | null;
      value: number | null;
    }) => {
      action: 'stock.opening_set' | 'stock.adjusted';
      reason?: string;
      after: Record<string, unknown>;
    },
  ): Promise<MovementView> {
    const date = businessDate(this.clock.now());
    try {
      return await this.inBusiness(caller, async (tx) => {
        const replay = await this.replay(tx, caller, requestKey, expected);
        if (replay !== null) return replay;
        let moved;
        try {
          [moved] = await moveStock(tx, {
            branchId: caller.branchId,
            actorId: caller.userId,
            businessDate: date,
            belowZero: 'refuse',
            requestKey,
            lines: [line],
          });
        } catch (error) {
          throw error instanceof StockRuleError ? answerFor(error) : error;
        }
        if (moved === undefined) throw new Error('No movement returned');
        const entry = log(moved);
        await recordEntry(tx, {
          actorId: caller.userId,
          action: entry.action,
          entityType: 'stock_movement',
          entityId: moved.movementId,
          branchId: caller.branchId,
          ...(entry.reason !== undefined && { reason: entry.reason }),
          after: { ...entry.after, businessDate: date },
        });
        return this.mustReplay(tx, caller, requestKey, expected);
      });
    } catch (error) {
      if (!isKeyTaken(error)) throw error;
      return this.inBusiness(caller, (tx) => this.mustReplay(tx, caller, requestKey, expected));
    }
  }

  /** The movement made with this key, if any; `422 key_reused` if it was a different change. */
  private async replay(
    tx: Transaction,
    caller: Caller,
    requestKey: string,
    expected: Expected,
  ): Promise<MovementView | null> {
    const [row] = await tx
      .select({ movement: stockMovements, name: users.name, username: users.username })
      .from(stockMovements)
      .innerJoin(users, eq(users.id, stockMovements.actorId))
      .where(eq(stockMovements.requestKey, requestKey));
    if (row === undefined) return null;
    const stored = row.movement;
    const same =
      stored.itemId === expected.itemId &&
      stored.kind === expected.kind &&
      stored.quantity === expected.quantity &&
      stored.reason === expected.reason &&
      stored.note === expected.note &&
      stored.branchId === caller.branchId;
    if (!same) {
      throw new HttpException({ code: 'key_reused' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return this.toView(stored, row.name ?? row.username, caller);
  }

  private async mustReplay(
    tx: Transaction,
    caller: Caller,
    requestKey: string,
    expected: Expected,
  ): Promise<MovementView> {
    const view = await this.replay(tx, caller, requestKey, expected);
    if (view === null) throw new Error('Movement not found by its request key');
    return view;
  }

  // ---- Helpers ----

  /** The item, which must exist (404) and be goods (409): a service has no stock. */
  private async goods(tx: Transaction, itemId: string): Promise<{ stockUnit: BuiltInUnit }> {
    const [item] = await tx
      .select({ kind: items.kind, stockUnit: items.stockUnit })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundException({ code: 'not_found' });
    if (item.kind !== 'goods') throw new ConflictException({ code: 'service_has_no_stock' });
    return { stockUnit: item.stockUnit as BuiltInUnit };
  }

  private toView(movement: MovementRecord, actorName: string | null, caller: Caller): MovementView {
    return {
      id: movement.id,
      branchId: movement.branchId,
      kind: movement.kind as StockMovementKind,
      quantity: movement.quantity,
      balanceAfter: movement.balanceAfter,
      ...(seesCost(caller) && { unitCost: movement.unitCost, value: movement.value }),
      reason: movement.reason as AdjustmentReason | null,
      note: movement.note,
      businessDate: movement.businessDate,
      actorId: movement.actorId,
      actorName,
      createdAt: movement.createdAt.toISOString(),
    };
  }
}
