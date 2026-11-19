import { ConflictException } from '@nestjs/common';
import { withBusiness, type Database, type Transaction } from '@business-software/db';
import type { Caller } from '../http/session.js';

/** Unique indexes whose refusal is the visitor's to fix, and the code the screen translates. */
const CONFLICTS: Record<string, string> = {
  items_live_name_unique: 'name_taken',
  items_live_code_unique: 'code_taken',
  item_barcodes_live_code_unique: 'barcode_taken',
  item_units_live_unit_unique: 'duplicate_pack',
  categories_live_name_unique: 'name_taken',
  units_live_name_unique: 'name_taken',
};

/**
 * Runs `work` and turns a unique-index refusal from the list above into `409 { code }`. Any
 * other database error stays an error (a 500): it means a bug, not a choice to make again.
 */
export async function answerConflicts<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    // Drizzle wraps driver errors; PostgreSQL's code and constraint are on `cause`.
    const cause =
      error instanceof Error ? (error.cause as Record<string, unknown> | undefined) : undefined;
    const constraint = cause?.code === '23505' ? cause.constraint : undefined;
    if (typeof constraint === 'string' && Object.hasOwn(CONFLICTS, constraint)) {
      throw new ConflictException({ code: CONFLICTS[constraint] });
    }
    throw error;
  }
}

/** `work` in one transaction as the caller's business, with unique-index refusals as 409s. */
export function inBusiness<T>(
  database: Database,
  caller: Caller,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return answerConflicts(withBusiness(database.db, caller.businessId, work));
}

/** The keys whose values differ, as `before` and `after` objects (compared as JSON). */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const keys = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (keys.length === 0) return null;
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, after[key]])),
  };
}
