// Drizzle table definitions (ADRs 0006, 0027). Every business-owned table uses the helpers
// below; src/tenancy-guard.test.ts fails if a table misses one.
import { sql } from 'drizzle-orm';
import {
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Time-ordered UUIDs, so new rows append to the index (ADR 0027). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const businessId = () =>
  uuid('business_id')
    .notNull()
    .references(() => businesses.id);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Rows are visible and writable only inside `withBusiness` for their own business. The same
 * check in USING and WITH CHECK stops inserting, or moving a row into, another business.
 * The migration adds FORCE ROW LEVEL SECURITY by hand: drizzle-kit can't generate it.
 */
export function tenantPolicy(column: AnyPgColumn) {
  const check = sql`${column} = (select app_current_business_id())`;
  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: check,
    withCheck: check,
  });
}

export const businesses = pgTable(
  'businesses',
  { id: id(), name: text('name').notNull(), createdAt: createdAt() },
  (t) => [tenantPolicy(t.id)],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    businessId: businessId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  // Branch-level tables reference (business_id, branch_id), so a row can't point at
  // another business's branch.
  (t) => [
    tenantPolicy(t.businessId),
    unique('branches_business_id_id_unique').on(t.businessId, t.id),
  ],
);
