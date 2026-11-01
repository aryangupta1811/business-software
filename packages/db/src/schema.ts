// Drizzle table definitions (ADRs 0006, 0027). Every business-owned table uses the helpers
// below; src/tenancy-guard.test.ts fails if a table misses one.
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  jsonb,
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

// Append-only: the migration revokes UPDATE from app_runtime, and DELETE was never granted
// (ADR 0028). Rows are written only through recordEntry, which never passes business_id.
export const entryLog = pgTable(
  'entry_log',
  {
    id: id(),
    businessId: businessId().default(sql`app_current_business_id()`),
    branchId: uuid('branch_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t.businessId),
    foreignKey({
      name: 'entry_log_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
  ],
);
