// Drizzle table definitions (ADRs 0006, 0027). Every business-owned table uses the helpers
// below; src/tenancy-guard.test.ts fails if a table misses one.
import { BUSINESS_TYPES, FEATURES, GST_STATUSES } from '@business-software/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// A list of fixed names as SQL literals. Only for the constants in packages/shared, never for
// input: changing a list there makes drizzle-kit generate the new check.
const literals = (values: readonly string[]): SQL =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

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

// Module 00 #6–8, #21, #29. Format checks repeat the shared schemas' rules, so the database
// refuses a bad value even from code that skipped them.
export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    name: text('name').notNull(),
    businessType: text('business_type').notNull(),
    phone: text('phone').notNull(),
    gstStatus: text('gst_status').notNull(),
    pan: text('pan'),
    features: text('features').array().notNull(),
    ownerLockMinutes: smallint('owner_lock_minutes').notNull().default(5),
    staffIdleMinutes: smallint('staff_idle_minutes').notNull().default(30),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t.id),
    check(
      'businesses_business_type_check',
      sql`${t.businessType} in (${literals(BUSINESS_TYPES)})`,
    ),
    check('businesses_gst_status_check', sql`${t.gstStatus} in (${literals(GST_STATUSES)})`),
    check('businesses_phone_check', sql`${t.phone} ~ '^[1-9][0-9]{9}$'`),
    check('businesses_pan_check', sql`${t.pan} ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check('businesses_features_check', sql`${t.features} <@ array[${literals(FEATURES)}]::text[]`),
    check('businesses_owner_lock_minutes_check', sql`${t.ownerLockMinutes} between 1 and 30`),
    check('businesses_staff_idle_minutes_check', sql`${t.staffIdleMinutes} between 5 and 120`),
  ],
);

// Place-based details are per branch (Module 00 #14): a branch in another state has its own
// GSTIN, and licences belong to the premises.
export const branches = pgTable(
  'branches',
  {
    id: id(),
    businessId: businessId(),
    name: text('name').notNull(),
    stateCode: text('state_code').notNull(),
    address: text('address'),
    pinCode: text('pin_code'),
    gstin: text('gstin'),
    drugLicence: text('drug_licence'),
    fssai: text('fssai'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Branch-level tables reference (business_id, branch_id), so a row can't point at
  // another business's branch.
  (t) => [
    tenantPolicy(t.businessId),
    unique('branches_business_id_id_unique').on(t.businessId, t.id),
    check('branches_state_code_check', sql`${t.stateCode} ~ '^[0-9]{2}$'`),
    check('branches_pin_code_check', sql`${t.pinCode} ~ '^[1-9][0-9]{5}$'`),
    // The GSTIN starts with the branch's own state code.
    check(
      'branches_gstin_check',
      sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and left(${t.gstin}, 2) = ${t.stateCode}`,
    ),
    check('branches_fssai_check', sql`${t.fssai} ~ '^[0-9]{14}$'`),
  ],
);

// Owner and staff (Module 00 #15, #27). P1.3 creates the owner at signup; P1.4 adds sessions,
// P1.5 staff logins.
export const users = pgTable(
  'users',
  {
    id: id(),
    businessId: businessId(),
    role: text('role').notNull(),
    name: text('name'),
    email: text('email'),
    /** A PHC string (ADR 0035); null for staff without a login (Module 00 #19). */
    passwordHash: text('password_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t.businessId),
    unique('users_business_id_id_unique').on(t.businessId, t.id),
    // #27: one email, one owner account across the whole app. Unique indexes see every row,
    // whatever RLS hides, so a second signup fails here (23505) with no cross-business read.
    // The one unique key without business_id, on purpose (ADR 0027 note).
    uniqueIndex('users_owner_email_unique')
      .on(t.email)
      .where(sql`${t.role} = 'owner'`),
    uniqueIndex('users_one_owner_per_business')
      .on(t.businessId)
      .where(sql`${t.role} = 'owner'`),
    check('users_role_check', sql`${t.role} in ('owner', 'staff')`),
    check('users_email_check', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_owner_email_check', sql`${t.role} <> 'owner' or ${t.email} is not null`),
  ],
);

// Module 00 #31: shown once at signup, stored only as a SHA-256 hash. A used key gets
// `used_at` and a new row replaces it (P1.4); nothing is deleted.
export const recoveryKeys = pgTable(
  'recovery_keys',
  {
    id: id(),
    businessId: businessId(),
    userId: uuid('user_id').notNull(),
    keyHash: text('key_hash').notNull(),
    createdAt: createdAt(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    tenantPolicy(t.businessId),
    foreignKey({
      name: 'recovery_keys_user_fk',
      columns: [t.businessId, t.userId],
      foreignColumns: [users.businessId, users.id],
    }),
    uniqueIndex('recovery_keys_one_unused_per_user')
      .on(t.businessId, t.userId)
      .where(sql`${t.usedAt} is null`),
    check('recovery_keys_key_hash_check', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
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
    // ADR 0028: the actor is a user of the same business; NULL is the system.
    foreignKey({
      name: 'entry_log_actor_fk',
      columns: [t.businessId, t.actorId],
      foreignColumns: [users.businessId, users.id],
    }),
  ],
);
