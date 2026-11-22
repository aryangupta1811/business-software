// Drizzle table definitions (ADRs 0006, 0027). Every business-owned table uses the helpers
// below; src/tenancy-guard.test.ts fails if a table misses one.
import {
  ALERT_FAMILIES,
  ALERT_SUBJECT_TYPES,
  ALERT_TYPES,
  BUILT_IN_UNITS,
  BUSINESS_TYPES,
  FEATURES,
  ADJUSTMENT_REASONS,
  APPROVAL_KINDS,
  BILL_DOCUMENTS,
  GST_RATES,
  GST_STATUSES,
  INDIAN_STATES,
  ITEM_KINDS,
  NEGATIVE_STOCK_SETTINGS,
  PAYMENT_MODES,
  PRICE_LISTS,
  STOCK_MOVEMENT_KINDS,
  type StockAlertDetails,
} from '@business-software/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
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
 * The two policies every tenant table has; spread them into the table's extra config.
 *
 * - `tenant_isolation`: rows are visible and writable only inside `withBusiness` for their
 *   own business. The same check in USING and WITH CHECK stops inserting, or moving a row
 *   into, another business.
 * - `backup_read` (ADR 0037): the backup role reads every row and writes none. Only
 *   app_backup is in it, and no app role belongs to app_backup (tenancy guard). Without it
 *   the nightly pg_dump, which runs with RLS on, would write this table empty.
 *
 * The migration adds FORCE ROW LEVEL SECURITY by hand: drizzle-kit can't generate it.
 */
export function tenantPolicies(column: AnyPgColumn) {
  const check = sql`${column} = (select app_current_business_id())`;
  return [
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: check,
      withCheck: check,
    }),
    pgPolicy('backup_read', {
      as: 'permissive',
      for: 'select',
      to: 'app_backup',
      using: sql`true`,
    }),
  ];
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
    /** Module 01 #12: selling past zero stock warns or is blocked (P1.14 reads it). */
    negativeStock: text('negative_stock').notNull().default('warn'),
    /** `00` #61: starts a one-branch business's invoice numbers; null for none (`26-27/42`). */
    invoicePrefix: text('invoice_prefix'),
    /** The alert types the app shows (Module 07 #3). A type left out still records alerts. */
    alertTypes: text('alert_types')
      .array()
      .notNull()
      .default(sql`array[${literals(ALERT_TYPES)}]::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.id),
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
    check(
      'businesses_alert_types_check',
      sql`${t.alertTypes} <@ array[${literals(ALERT_TYPES)}]::text[]`,
    ),
    check('businesses_invoice_prefix_check', sql`${t.invoicePrefix} ~ '^[A-Z0-9]{1,4}$'`),
    check(
      'businesses_negative_stock_check',
      sql`${t.negativeStock} in (${literals(NEGATIVE_STOCK_SETTINGS)})`,
    ),
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
    /** Short code for invoice numbers and lists: 1 to 4 capital letters or digits (P1.6, `00` #61). */
    code: text('code').notNull(),
    stateCode: text('state_code').notNull(),
    address: text('address'),
    pinCode: text('pin_code'),
    gstin: text('gstin'),
    drugLicence: text('drug_licence'),
    fssai: text('fssai'),
    /** Archived, never deleted (ADR 0007): its history stays readable. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Branch-level tables reference (business_id, branch_id), so a row can't point at
  // another business's branch.
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('branches_business_id_id_unique').on(t.businessId, t.id),
    unique('branches_business_id_code_unique').on(t.businessId, t.code),
    check('branches_code_check', sql`${t.code} ~ '^[A-Z0-9]{1,4}$'`),
    // Not 97 (Other Territory): a place of supply outside any state, never a shop's address.
    check(
      'branches_state_code_check',
      sql`${t.stateCode} ~ '^[0-9]{2}$' and ${t.stateCode} <> '97'`,
    ),
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
    /** Staff only, lower case, unique within the business (Module 00 #28, #43). */
    username: text('username'),
    /** Module 00 #32; until then only the recovery key resets the password. */
    emailConfirmedAt: timestamp('email_confirmed_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    /** Module 00 #34: a login that left is never deleted; it can't log in and its sessions end. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    /** Module 00 #35: the branch a staff login belongs to; null for the owner. */
    homeBranchId: uuid('home_branch_id'),
    /**
     * Staff switches the owner turned on / off from the defaults (P1.5, ADR 0044). Names aren't
     * checked here: the list grows with every module, so the code reads them with
     * `effectivePermissions`, which ignores any it doesn't know.
     */
    permissionsAdded: text('permissions_added')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionsRemoved: text('permissions_removed')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `02` #12: what this login may discount alone, in basis points; null: never set. */
    discountLimitBasisPoints: integer('discount_limit_basis_points'),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('users_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'users_home_branch_fk',
      columns: [t.businessId, t.homeBranchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
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
    // Lower case, trimmed, printable ASCII only: one mailbox has one spelling, so a look-alike
    // letter or a zero-width space can't make a second owner for it (#27).
    check(
      'users_email_check',
      sql`${t.email} = lower(btrim(${t.email})) and ${t.email} ~ '^[!-~]+$'`,
    ),
    check('users_owner_email_check', sql`${t.role} <> 'owner' or ${t.email} is not null`),
    unique('users_business_id_username_unique').on(t.businessId, t.username),
    check('users_username_check', sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
    check('users_owner_username_check', sql`${t.role} <> 'owner' or ${t.username} is null`),
    // A login always has a username (P1.4 planned it); staff without a login come with P2.3.
    check(
      'users_staff_username_check',
      sql`${t.role} <> 'staff' or ${t.passwordHash} is null or ${t.username} is not null`,
    ),
    check(
      'users_staff_home_branch_check',
      sql`${t.role} <> 'staff' or ${t.homeBranchId} is not null`,
    ),
    check(
      'users_permissions_overlap_check',
      sql`not (${t.permissionsAdded} && ${t.permissionsRemoved})`,
    ),
    check('users_discount_limit_check', sql`${t.discountLimitBasisPoints} between 0 and 10000`),
    // The owner holds everything by role, so these stay empty.
    check(
      'users_owner_permissions_check',
      sql`${t.role} <> 'owner' or (cardinality(${t.permissionsAdded}) = 0 and cardinality(${t.permissionsRemoved}) = 0 and ${t.discountLimitBasisPoints} is null)`,
    ),
  ],
);

// The extra branches a staff login may work at (Module 00 #35, P1.6); the home branch is
// always allowed and isn't repeated here. Permission data, not a business record: unticking a
// branch deletes its row (the only delete the app may do) and every change is in the entry log.
export const staffBranches = pgTable(
  'staff_branches',
  {
    id: id(),
    businessId: businessId(),
    userId: uuid('user_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('staff_branches_business_id_user_id_branch_id_unique').on(
      t.businessId,
      t.userId,
      t.branchId,
    ),
    foreignKey({
      name: 'staff_branches_user_fk',
      columns: [t.businessId, t.userId],
      foreignColumns: [users.businessId, users.id],
    }),
    foreignKey({
      name: 'staff_branches_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
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
    ...tenantPolicies(t.businessId),
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
    ...tenantPolicies(t.businessId),
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

// Every token is stored as its SHA-256 in lower-case hex (P1.4 design, section 4).
const tokenHashCheck = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

// A counter computer that knows its business (Module 00 #28, #44). The browser holds
// `<businessId>.<token>` in a cookie; only the hash is stored. Forgotten, never deleted.
export const devices = pgTable(
  'devices',
  {
    id: id(),
    businessId: businessId(),
    branchId: uuid('branch_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    name: text('name'),
    registeredBy: uuid('registered_by').notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('devices_business_id_id_unique').on(t.businessId, t.id),
    unique('devices_business_id_token_hash_unique').on(t.businessId, t.tokenHash),
    foreignKey({
      name: 'devices_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'devices_registered_by_fk',
      columns: [t.businessId, t.registeredBy],
      foreignColumns: [users.businessId, users.id],
    }),
    check('devices_token_hash_check', tokenHashCheck(t.tokenHash)),
  ],
);

/** Why a session ended (P1.4 design, section 3). */
export const SESSION_END_REASONS = [
  'logout',
  'idle',
  'replaced',
  'password_changed',
  'deactivated',
  'reset',
  'device_forgotten',
  'device_moved',
  'branch_removed',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

// A login on one browser (ADR 0009). Rows end with `ended_at` and are kept: they show who was
// logged in when (ADR 0007). The cookie holds `<businessId>.<token>`; only hashes are stored.
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    businessId: businessId(),
    userId: uuid('user_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id'),
    tokenHash: text('token_hash').notNull(),
    csrfHash: text('csrf_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    /** The owner's auto-lock (Module 00 #21); null while unlocked. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('sessions_business_id_token_hash_unique').on(t.businessId, t.tokenHash),
    foreignKey({
      name: 'sessions_user_fk',
      columns: [t.businessId, t.userId],
      foreignColumns: [users.businessId, users.id],
    }),
    foreignKey({
      name: 'sessions_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'sessions_device_fk',
      columns: [t.businessId, t.deviceId],
      foreignColumns: [devices.businessId, devices.id],
    }),
    index('sessions_open_by_user')
      .on(t.businessId, t.userId)
      .where(sql`${t.endedAt} is null`),
    check('sessions_token_hash_check', tokenHashCheck(t.tokenHash)),
    check('sessions_csrf_hash_check', tokenHashCheck(t.csrfHash)),
    check('sessions_end_reason_check', sql`${t.endReason} in (${literals(SESSION_END_REASONS)})`),
    check('sessions_ended_check', sql`(${t.endedAt} is null) = (${t.endReason} is null)`),
    check('sessions_user_agent_check', sql`length(${t.userAgent}) <= 200`),
  ],
);

/** What an emailed link does (Module 00 #30, #32). */
export const AUTH_TOKEN_KINDS = ['confirm_email', 'reset_password'] as const;
export type AuthTokenKind = (typeof AUTH_TOKEN_KINDS)[number];

// A one-time link sent by email (P1.4 design, section 6). Only the hash is stored. Using a
// token, or making a newer one, sets `used_at`; rows are kept, so the trail shows every link.
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    businessId: businessId(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    foreignKey({
      name: 'auth_tokens_user_fk',
      columns: [t.businessId, t.userId],
      foreignColumns: [users.businessId, users.id],
    }),
    // One open link per user and kind: a new link replaces the old one in the same transaction.
    uniqueIndex('auth_tokens_one_open_per_user')
      .on(t.businessId, t.userId, t.kind)
      .where(sql`${t.usedAt} is null`),
    check('auth_tokens_kind_check', sql`${t.kind} in (${literals(AUTH_TOKEN_KINDS)})`),
    check('auth_tokens_token_hash_check', tokenHashCheck(t.tokenHash)),
    check('auth_tokens_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

// ---- Items (P1.7, Module 01; design docs/plans/2026-11-19-p1.7-items-design.md) ----
// Names sort with the `item_name` ICU collation (migration 0005): Latin before Devanagari,
// numbers by value. Queries name it (`collate item_name`); the columns keep the default.
// Nothing here is ever deleted: rows are archived (`archived_at`) or removed (`removed_at`).

const money = (name: string) => bigint(name, { mode: 'number' });
/** Defaults to the transaction's business, like entry_log: code never passes another one. */
const ownBusinessId = () => businessId().default(sql`app_current_business_id()`);
const archivedAt = () => timestamp('archived_at', { withTimezone: true });

/** Unique among live rows, case ignored, within one business. */
function liveName(
  name: string,
  t: { businessId: AnyPgColumn; name: AnyPgColumn; archivedAt: AnyPgColumn },
) {
  return uniqueIndex(name)
    .on(t.businessId, sql`lower(${t.name})`)
    .where(sql`${t.archivedAt} is null`);
}

// Module 00 #4: none pre-loaded; owners add their own.
export const categories = pgTable(
  'categories',
  {
    id: id(),
    businessId: ownBusinessId(),
    name: text('name').notNull(),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('categories_business_id_id_unique').on(t.businessId, t.id),
    liveName('categories_live_name_unique', t),
    check('categories_name_check', sql`char_length(${t.name}) between 1 and 60`),
  ],
);

// Module 01 #16: the owner's own units, each a size of a built-in unit (1 crate = 24 piece).
export const units = pgTable(
  'units',
  {
    id: id(),
    businessId: ownBusinessId(),
    name: text('name').notNull(),
    hindiName: text('hindi_name'),
    baseUnit: text('base_unit').notNull(),
    /** Thousandths of the base unit; an item can change it for itself (owner's answer 3). */
    defaultSize: bigint('default_size', { mode: 'number' }).notNull(),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('units_business_id_id_unique').on(t.businessId, t.id),
    liveName('units_live_name_unique', t),
    check('units_name_check', sql`char_length(${t.name}) between 1 and 30`),
    check('units_not_built_in_check', sql`lower(${t.name}) not in (${literals(BUILT_IN_UNITS)})`),
    check('units_base_unit_check', sql`${t.baseUnit} in (${literals(BUILT_IN_UNITS)})`),
    check('units_default_size_check', sql`${t.defaultSize} > 0`),
  ],
);

// Module 01 #1–3: one catalogue and one price list per business (owner's answer 4); stock and
// low-stock levels per branch. Prices are paise per stock unit (ADR 0008).
export const items = pgTable(
  'items',
  {
    id: id(),
    businessId: ownBusinessId(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    hindiName: text('hindi_name'),
    code: text('code'),
    categoryId: uuid('category_id'),
    brand: text('brand'),
    stockUnit: text('stock_unit').notNull(),
    sellingPrice: money('selling_price').notNull(),
    wholesalePrice: money('wholesale_price'),
    purchasePrice: money('purchase_price'),
    mrp: money('mrp'),
    priceIncludesTax: boolean('price_includes_tax').notNull().default(true),
    /** Basis points, one of GST_RATES; null until the owner sets it. */
    gstRate: integer('gst_rate'),
    hsn: text('hsn'),
    archivedAt: archivedAt(),
    /** +1 on every save: a save made from an older copy answers 409 (design §6). */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('items_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'items_category_fk',
      columns: [t.businessId, t.categoryId],
      foreignColumns: [categories.businessId, categories.id],
    }),
    liveName('items_live_name_unique', t),
    uniqueIndex('items_live_code_unique')
      .on(t.businessId, sql`lower(${t.code})`)
      .where(sql`${t.archivedAt} is null`),
    // P1.13 copies the catalogue into the browser and asks what changed since.
    index('items_updated_at_idx').on(t.businessId, t.updatedAt),
    check('items_kind_check', sql`${t.kind} in (${literals(ITEM_KINDS)})`),
    check('items_name_check', sql`char_length(${t.name}) between 1 and 100`),
    check('items_code_check', sql`${t.code} ~ '^[!-~]{1,20}$'`),
    check('items_stock_unit_check', sql`${t.stockUnit} in (${literals(BUILT_IN_UNITS)})`),
    check(
      'items_prices_check',
      sql`${t.sellingPrice} >= 0 and ${t.wholesalePrice} >= 0 and ${t.purchasePrice} >= 0 and ${t.mrp} > 0`,
    ),
    // Module 01 #3: never above MRP. MRP includes every tax, so the price must too (answer 2).
    check(
      'items_mrp_check',
      sql`${t.mrp} is null or (${t.priceIncludesTax} and ${t.sellingPrice} <= ${t.mrp} and coalesce(${t.wholesalePrice}, 0) <= ${t.mrp})`,
    ),
    check('items_service_check', sql`${t.kind} = 'goods' or ${t.mrp} is null`),
    check('items_gst_rate_check', sql`${t.gstRate} in (${sql.raw(GST_RATES.join(', '))})`),
    // Goods: HSN 4, 6 or 8 digits. Services: SAC, 6 digits from 99.
    check(
      'items_hsn_check',
      sql`case ${t.kind} when 'goods' then ${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' else ${t.hsn} ~ '^99[0-9]{4}$' end`,
    ),
    check('items_version_check', sql`${t.version} >= 1`),
  ],
);

// Module 01 #2: other units an item is bought or sold in, each with its size in stock units.
export const itemUnits = pgTable(
  'item_units',
  {
    id: id(),
    businessId: ownBusinessId(),
    itemId: uuid('item_id').notNull(),
    /** A built-in unit, or else one of the owner's units (`unit_id`); exactly one is set. */
    unitCode: text('unit_code'),
    unitId: uuid('unit_id'),
    /** Thousandths of the item's stock unit in one pack. */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Null: size × the item's price. */
    sellingPrice: money('selling_price'),
    mrp: money('mrp'),
    soldAsPack: boolean('sold_as_pack').notNull(),
    boughtAsPack: boolean('bought_as_pack').notNull(),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('item_units_business_id_id_unique').on(t.businessId, t.id),
    // Barcodes check that their pack belongs to their item.
    unique('item_units_business_id_item_id_id_unique').on(t.businessId, t.itemId, t.id),
    foreignKey({
      name: 'item_units_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    foreignKey({
      name: 'item_units_unit_fk',
      columns: [t.businessId, t.unitId],
      foreignColumns: [units.businessId, units.id],
    }),
    uniqueIndex('item_units_live_unit_unique')
      .on(t.businessId, t.itemId, sql`coalesce(${t.unitCode}, ${t.unitId}::text)`)
      .where(sql`${t.archivedAt} is null`),
    check('item_units_one_unit_check', sql`num_nonnulls(${t.unitCode}, ${t.unitId}) = 1`),
    check('item_units_unit_code_check', sql`${t.unitCode} in (${literals(BUILT_IN_UNITS)})`),
    check(
      'item_units_numbers_check',
      sql`${t.size} > 0 and ${t.sellingPrice} >= 0 and ${t.mrp} > 0`,
    ),
    check(
      'item_units_mrp_check',
      sql`${t.mrp} is null or ${t.sellingPrice} is null or ${t.sellingPrice} <= ${t.mrp}`,
    ),
  ],
);

// Module 01 #8. A code belongs to one live item or pack per business; removing it from an item
// (`removed_at`) frees it. An archived item keeps its codes, so a scan can offer a restore.
export const itemBarcodes = pgTable(
  'item_barcodes',
  {
    id: id(),
    businessId: ownBusinessId(),
    itemId: uuid('item_id').notNull(),
    /** The pack the code is printed on; null for the stock unit. */
    itemUnitId: uuid('item_unit_id'),
    code: text('code').notNull(),
    /** Made by the app (EAN-13 from 2), for loose and unbranded items. */
    inStore: boolean('in_store').notNull().default(false),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    foreignKey({
      name: 'item_barcodes_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    // The pack must be one of this item's (MATCH SIMPLE: skipped when item_unit_id is null).
    foreignKey({
      name: 'item_barcodes_pack_fk',
      columns: [t.businessId, t.itemId, t.itemUnitId],
      foreignColumns: [itemUnits.businessId, itemUnits.itemId, itemUnits.id],
    }),
    uniqueIndex('item_barcodes_live_code_unique')
      .on(t.businessId, t.code)
      .where(sql`${t.removedAt} is null`),
    check('item_barcodes_code_check', sql`${t.code} ~ '^[!-~]{4,48}$'`),
  ],
);

// Module 01 #1: an item's low-stock level at one branch, in thousandths of its stock unit.
export const itemBranchLevels = pgTable(
  'item_branch_levels',
  {
    id: id(),
    businessId: ownBusinessId(),
    itemId: uuid('item_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    lowStockLevel: bigint('low_stock_level', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    foreignKey({
      name: 'item_branch_levels_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    foreignKey({
      name: 'item_branch_levels_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    unique('item_branch_levels_item_branch_unique').on(t.businessId, t.itemId, t.branchId),
    check('item_branch_levels_level_check', sql`${t.lowStockLevel} >= 0`),
  ],
);

// ---- Customers (P1.13 design §7; `02` #2, #7). P1.18 adds credit limit, due days, the ledger ----
// Archived, never deleted. A live phone or GSTIN belongs to one customer per business.
export const customers = pgTable(
  'customers',
  {
    id: id(),
    businessId: ownBusinessId(),
    name: text('name').notNull(),
    /** 10 digits (normalizePhone). */
    phone: text('phone'),
    gstin: text('gstin'),
    legalName: text('legal_name'),
    address: text('address'),
    pinCode: text('pin_code'),
    /** From the GSTIN's first two digits when there is one. */
    stateCode: text('state_code'),
    archivedAt: archivedAt(),
    /** +1 on every save: a save made from an older copy answers 409 stale. */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('customers_business_id_id_unique').on(t.businessId, t.id),
    uniqueIndex('customers_live_phone_unique')
      .on(t.businessId, t.phone)
      .where(sql`${t.phone} is not null and ${t.archivedAt} is null`),
    uniqueIndex('customers_live_gstin_unique')
      .on(t.businessId, t.gstin)
      .where(sql`${t.gstin} is not null and ${t.archivedAt} is null`),
    check('customers_name_check', sql`char_length(${t.name}) between 1 and 100`),
    check('customers_phone_check', sql`${t.phone} ~ '^[1-9][0-9]{9}$'`),
    // A GSTIN brings its state, legal name and address (design §7).
    check(
      'customers_gstin_check',
      sql`${t.gstin} is null or (${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and ${t.stateCode} is not distinct from left(${t.gstin}, 2) and ${t.legalName} is not null and ${t.address} is not null)`,
    ),
    check('customers_legal_name_check', sql`char_length(${t.legalName}) between 1 and 100`),
    check('customers_address_check', sql`char_length(${t.address}) between 1 and 200`),
    check('customers_pin_code_check', sql`${t.pinCode} ~ '^[1-9][0-9]{5}$'`),
    check(
      'customers_state_code_check',
      sql`${t.stateCode} in (${literals(INDIAN_STATES.map((s) => s.code))})`,
    ),
    check('customers_version_check', sql`${t.version} >= 1`),
  ],
);

// ---- Held bills (P1.13 design §9; `02` #8) ----
// A bill put aside to serve the next customer. It never touches stock. Closed by resuming or
// discarding it, never deleted: a discarded bill stays visible (question 7).
export const heldBills = pgTable(
  'held_bills',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    /** The bill's idempotency key (ADR 0007); it stays with the bill when resumed. */
    billKey: uuid('bill_key').notNull(),
    label: text('label'),
    /** The cart as billCartSchema, checked before it's stored. */
    draft: jsonb('draft').notNull(),
    /** As shown when held, for the list; the save re-prices everything. */
    totalPaise: money('total_paise').notNull(),
    lineCount: integer('line_count').notNull(),
    heldBy: uuid('held_by').notNull(),
    closedBy: uuid('closed_by'),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    discardedAt: timestamp('discarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('held_bills_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'held_bills_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'held_bills_held_by_fk',
      columns: [t.businessId, t.heldBy],
      foreignColumns: [users.businessId, users.id],
    }),
    foreignKey({
      name: 'held_bills_closed_by_fk',
      columns: [t.businessId, t.closedBy],
      foreignColumns: [users.businessId, users.id],
    }),
    // One open copy of a bill: holding it again (a retry) finds the first.
    uniqueIndex('held_bills_open_bill_key_unique')
      .on(t.businessId, t.billKey)
      .where(sql`${t.resumedAt} is null and ${t.discardedAt} is null`),
    // The branch's open held bills, newest first.
    index('held_bills_open_idx')
      .on(t.businessId, t.branchId, t.id)
      .where(sql`${t.resumedAt} is null and ${t.discardedAt} is null`),
    check('held_bills_label_check', sql`char_length(${t.label}) between 1 and 40`),
    check('held_bills_numbers_check', sql`${t.totalPaise} >= 0 and ${t.lineCount} >= 1`),
    // Closed at most one way, and closed exactly when someone closed it.
    check(
      'held_bills_closed_check',
      sql`num_nonnulls(${t.resumedAt}, ${t.discardedAt}) <= 1 and (${t.closedBy} is null) = (num_nonnulls(${t.resumedAt}, ${t.discardedAt}) = 0)`,
    ),
  ],
);

// ---- Owner approvals (P1.13 design §6; `02` #12) ----
// The owner's OK, given with their password at the counter, for discounts above a cashier's
// limit on one bill. One use, 30 minutes; the save (P1.14) sets used_at.
export const ownerApprovals = pgTable(
  'owner_approvals',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    billKey: uuid('bill_key').notNull(),
    kind: text('kind').notNull(),
    lineBasisPoints: integer('line_basis_points').notNull(),
    billBasisPoints: integer('bill_basis_points').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    approvedBy: uuid('approved_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('owner_approvals_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'owner_approvals_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'owner_approvals_requested_by_fk',
      columns: [t.businessId, t.requestedBy],
      foreignColumns: [users.businessId, users.id],
    }),
    foreignKey({
      name: 'owner_approvals_approved_by_fk',
      columns: [t.businessId, t.approvedBy],
      foreignColumns: [users.businessId, users.id],
    }),
    check('owner_approvals_kind_check', sql`${t.kind} in (${literals(APPROVAL_KINDS)})`),
    check(
      'owner_approvals_shares_check',
      sql`${t.lineBasisPoints} between 0 and 10000 and ${t.billBasisPoints} between 0 and 10000`,
    ),
    check('owner_approvals_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

// ---- Bills (P1.14, design `docs/plans/2026-11-22-p1.14-save-bill-design.md`; ADR 0047) ----
// A saved bill is never edited (`02` #14): bills, their lines and payments are append-only (the
// migration revokes UPDATE; DELETE was never granted). Cancelling (P1.16) adds its own rows.

// The last invoice number per branch per financial year (ADR 0007 rule 5): a row locked by the
// bill's own transaction, so a rolled-back save gives its number back and there are no gaps.
export const invoiceCounters = pgTable(
  'invoice_counters',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    /** `2026-27`. */
    financialYear: text('financial_year').notNull(),
    lastNumber: integer('last_number').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('invoice_counters_business_id_id_unique').on(t.businessId, t.id),
    unique('invoice_counters_branch_year_unique').on(t.businessId, t.branchId, t.financialYear),
    foreignKey({
      name: 'invoice_counters_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    check('invoice_counters_year_check', sql`${t.financialYear} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('invoice_counters_last_number_check', sql`${t.lastNumber} >= 1`),
  ],
);

export const bills = pgTable(
  'bills',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    /** The idempotency key made when the bill was started (ADR 0007 rule 7). */
    billKey: uuid('bill_key').notNull(),
    /** A hash of the request: a retry must be the same request to get this bill back. */
    requestHash: text('request_hash').notNull(),
    financialYear: text('financial_year').notNull(),
    sequence: integer('sequence').notNull(),
    /** As printed, built at saving (`00` #61); never changes. */
    number: text('number').notNull(),
    document: text('document').notNull(),
    /** The IST day the bill belongs to (`06` #7). */
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    priceList: text('price_list').notNull(),
    supplierStateCode: text('supplier_state_code').notNull(),
    placeOfSupplyStateCode: text('place_of_supply_state_code').notNull(),
    tax: text('tax').notNull(),
    customerId: uuid('customer_id'),
    /** The customer's details at saving: a bill never changes with its customer. */
    buyer: jsonb('buyer'),
    /** The branch's name, address, GSTIN and licences at saving, for printing (P1.15). */
    seller: jsonb('seller').notNull(),
    grossPaise: money('gross_paise').notNull(),
    subtotalPaise: money('subtotal_paise').notNull(),
    billDiscountPaise: money('bill_discount_paise').notNull(),
    taxablePaise: money('taxable_paise').notNull(),
    cgstPaise: money('cgst_paise').notNull(),
    sgstPaise: money('sgst_paise').notNull(),
    igstPaise: money('igst_paise').notNull(),
    totalPaise: money('total_paise').notNull(),
    roundOffPaise: money('round_off_paise').notNull(),
    grandTotalPaise: money('grand_total_paise').notNull(),
    billDiscount: jsonb('bill_discount'),
    approvalId: uuid('approval_id'),
    heldBillId: uuid('held_bill_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('bills_business_id_id_unique').on(t.businessId, t.id),
    unique('bills_bill_key_unique').on(t.businessId, t.billKey),
    unique('bills_sequence_unique').on(t.businessId, t.branchId, t.financialYear, t.sequence),
    unique('bills_number_unique').on(t.businessId, t.financialYear, t.number),
    // An owner's OK is used by one bill only (P1.13 design §6).
    uniqueIndex('bills_approval_unique')
      .on(t.businessId, t.approvalId)
      .where(sql`${t.approvalId} is not null`),
    foreignKey({
      name: 'bills_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'bills_customer_fk',
      columns: [t.businessId, t.customerId],
      foreignColumns: [customers.businessId, customers.id],
    }),
    foreignKey({
      name: 'bills_approval_fk',
      columns: [t.businessId, t.approvalId],
      foreignColumns: [ownerApprovals.businessId, ownerApprovals.id],
    }),
    foreignKey({
      name: 'bills_held_bill_fk',
      columns: [t.businessId, t.heldBillId],
      foreignColumns: [heldBills.businessId, heldBills.id],
    }),
    foreignKey({
      name: 'bills_created_by_fk',
      columns: [t.businessId, t.createdBy],
      foreignColumns: [users.businessId, users.id],
    }),
    // A branch's bills, newest first (P1.15's list, P2.9's dashboard).
    index('bills_branch_idx').on(t.businessId, t.branchId, t.id),
    check('bills_year_check', sql`${t.financialYear} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('bills_sequence_check', sql`${t.sequence} >= 1`),
    // CGST Rule 46(b): at most 16 characters of letters, digits, hyphen and slash.
    check('bills_number_check', sql`${t.number} ~ '^[A-Z0-9/-]{1,16}$'`),
    check('bills_document_check', sql`${t.document} in (${literals(BILL_DOCUMENTS)})`),
    check('bills_price_list_check', sql`${t.priceList} in (${literals(PRICE_LISTS)})`),
    check('bills_tax_check', sql`${t.tax} in ('cgst-sgst', 'igst', 'none')`),
    check(
      'bills_states_check',
      sql`${t.supplierStateCode} ~ '^[0-9]{2}$' and ${t.placeOfSupplyStateCode} ~ '^[0-9]{2}$'`,
    ),
    // The engine's sums, held by the database too, so a stored bill always adds up.
    check(
      'bills_amounts_check',
      sql`${t.grossPaise} >= 0 and ${t.subtotalPaise} >= 0 and ${t.billDiscountPaise} >= 0 and ${t.taxablePaise} >= 0 and ${t.cgstPaise} >= 0 and ${t.sgstPaise} >= 0 and ${t.igstPaise} >= 0`,
    ),
    check(
      'bills_total_check',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`,
    ),
    check(
      'bills_grand_total_check',
      sql`${t.roundOffPaise} between -49 and 50 and ${t.grandTotalPaise} = ${t.totalPaise} + ${t.roundOffPaise} and ${t.grandTotalPaise} % 100 = 0`,
    ),
  ],
);

export const billLines = pgTable(
  'bill_lines',
  {
    id: id(),
    businessId: ownBusinessId(),
    billId: uuid('bill_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    itemId: uuid('item_id').notNull(),
    packId: uuid('pack_id'),
    /** Copies at saving, so the printed bill never changes with the item. */
    itemName: text('item_name').notNull(),
    itemHindiName: text('item_hindi_name'),
    /** A built-in unit's code or the owner's own unit's name: what one of the quantity is. */
    unit: text('unit').notNull(),
    hsn: text('hsn').notNull(),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    priceIncludesTax: boolean('price_includes_tax').notNull(),
    /** Of the pack, or of the stock unit. */
    quantityThousandths: bigint('quantity_thousandths', { mode: 'number' }).notNull(),
    /** Thousandths of the stock unit taken out; null for a service. */
    stockQuantity: bigint('stock_quantity', { mode: 'number' }),
    unitPricePaise: money('unit_price_paise').notNull(),
    discount: jsonb('discount'),
    amountPaise: money('amount_paise').notNull(),
    itemDiscountPaise: money('item_discount_paise').notNull(),
    grossPaise: money('gross_paise').notNull(),
    subtotalPaise: money('subtotal_paise').notNull(),
    billDiscountPaise: money('bill_discount_paise').notNull(),
    taxableBeforeDiscountsPaise: money('taxable_before_discounts_paise').notNull(),
    discountOffTaxablePaise: money('discount_off_taxable_paise').notNull(),
    taxablePaise: money('taxable_paise').notNull(),
    cgstPaise: money('cgst_paise').notNull(),
    sgstPaise: money('sgst_paise').notNull(),
    igstPaise: money('igst_paise').notNull(),
    totalPaise: money('total_paise').notNull(),
    /** Paise per stock unit at the sale (the branch's average cost): profit reads it. */
    unitCost: money('unit_cost'),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('bill_lines_business_id_id_unique').on(t.businessId, t.id),
    unique('bill_lines_line_unique').on(t.businessId, t.billId, t.lineNo),
    foreignKey({
      name: 'bill_lines_bill_fk',
      columns: [t.businessId, t.billId],
      foreignColumns: [bills.businessId, bills.id],
    }),
    foreignKey({
      name: 'bill_lines_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    index('bill_lines_item_idx').on(t.businessId, t.itemId),
    check('bill_lines_line_no_check', sql`${t.lineNo} >= 1`),
    check('bill_lines_quantity_check', sql`${t.quantityThousandths} > 0`),
    check('bill_lines_stock_quantity_check', sql`${t.stockQuantity} > 0`),
    check('bill_lines_rate_check', sql`${t.rateBasisPoints} between 0 and 10000`),
    check(
      'bill_lines_total_check',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`,
    ),
  ],
);

export const billPayments = pgTable(
  'bill_payments',
  {
    id: id(),
    businessId: ownBusinessId(),
    billId: uuid('bill_id').notNull(),
    mode: text('mode').notNull(),
    amountPaise: money('amount_paise').notNull(),
    /** Cash only: what the customer handed over. */
    tenderedPaise: money('tendered_paise'),
    reference: text('reference'),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('bill_payments_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'bill_payments_bill_fk',
      columns: [t.businessId, t.billId],
      foreignColumns: [bills.businessId, bills.id],
    }),
    index('bill_payments_bill_idx').on(t.businessId, t.billId),
    check('bill_payments_mode_check', sql`${t.mode} in (${literals(PAYMENT_MODES)})`),
    check('bill_payments_amount_check', sql`${t.amountPaise} > 0`),
    check(
      'bill_payments_tendered_check',
      sql`${t.tenderedPaise} is null or (${t.mode} = 'cash' and ${t.tenderedPaise} >= ${t.amountPaise})`,
    ),
    check('bill_payments_reference_check', sql`char_length(${t.reference}) between 1 and 40`),
  ],
);

// ---- Stock (P1.8, design `docs/plans/2026-11-20-p1.8-stock-ledger-design.md`; ADR 0007 rule 4) ----
// Both tables are written only by moveStock (src/stock.ts), in the action's own transaction.

// The running total per item per branch: the row two counters lock (ADR 0007 rules 4 and 6).
export const itemStock = pgTable(
  'item_stock',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    itemId: uuid('item_id').notNull(),
    /** Thousandths of the item's stock unit; below zero when sold past it (Module 01 #12). */
    quantity: bigint('quantity', { mode: 'number' }).notNull().default(0),
    /** Paise per stock unit (Module 01 #4); null until stock arrives at a known cost. */
    averageCost: money('average_cost'),
    /** The movement that last changed this row; null means nothing has moved yet (answer 4A). */
    lastMovementId: uuid('last_movement_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('item_stock_business_id_id_unique').on(t.businessId, t.id),
    unique('item_stock_item_branch_unique').on(t.businessId, t.branchId, t.itemId),
    foreignKey({
      name: 'item_stock_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'item_stock_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    check('item_stock_average_cost_check', sql`${t.averageCost} >= 0`),
  ],
);

// The ledger: append-only (the migration revokes UPDATE; DELETE was never granted). A mistake
// is fixed by a new movement. Later tasks add a key per source document (bill, purchase…).
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    itemId: uuid('item_id').notNull(),
    kind: text('kind').notNull(),
    /** Signed thousandths of the item's stock unit. */
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    /** Paise per stock unit at that moment; null when the item's cost is unknown. */
    unitCost: money('unit_cost'),
    /** Paise, signed: quantity × unit cost. */
    value: money('value'),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    /** The IST day the action belongs to (06 #7); created_at stays the database's own time. */
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    note: text('note'),
    actorId: uuid('actor_id').notNull(),
    /** Idempotency (ADR 0007 rule 7): a retried request finds its first movement. */
    requestKey: uuid('request_key'),
    /** The bill a sale belongs to (P1.14). */
    billId: uuid('bill_id'),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('stock_movements_business_id_id_unique').on(t.businessId, t.id),
    unique('stock_movements_request_key_unique').on(t.businessId, t.requestKey),
    foreignKey({
      name: 'stock_movements_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'stock_movements_item_fk',
      columns: [t.businessId, t.itemId],
      foreignColumns: [items.businessId, items.id],
    }),
    foreignKey({
      name: 'stock_movements_bill_fk',
      columns: [t.businessId, t.billId],
      foreignColumns: [bills.businessId, bills.id],
    }),
    foreignKey({
      name: 'stock_movements_actor_fk',
      columns: [t.businessId, t.actorId],
      foreignColumns: [users.businessId, users.id],
    }),
    // The history of one item at one branch, newest first, and the audit's sum.
    index('stock_movements_item_idx').on(t.businessId, t.branchId, t.itemId, t.id),
    check('stock_movements_kind_check', sql`${t.kind} in (${literals(STOCK_MOVEMENT_KINDS)})`),
    check('stock_movements_quantity_check', sql`${t.quantity} <> 0`),
    // Exactly the sales carry their bill, and a sale only takes stock out.
    check(
      'stock_movements_bill_check',
      sql`(${t.kind} = 'sale') = (${t.billId} is not null) and (${t.kind} <> 'sale' or ${t.quantity} < 0)`,
    ),
    check('stock_movements_unit_cost_check', sql`${t.unitCost} >= 0`),
    // Only adjustments carry a reason, and every adjustment has one (Module 01 #11).
    check(
      'stock_movements_reason_check',
      sql`(${t.kind} = 'adjustment') = (${t.reason} is not null) and ${t.reason} in (${literals(ADJUSTMENT_REASONS)})`,
    ),
    check('stock_movements_note_check', sql`char_length(${t.note}) between 1 and 200`),
  ],
);

// ---- Alerts (P2.7 design `docs/plans/2026-11-22-p2.7-alerts-design.md`; Module 07; ADR 0046) ----
// Raised and cleared by the code that changes what they are about, in the same transaction
// (src/alerts.ts). A cleared alert stays as history: nothing here is ever deleted.

const ALERT_TYPE_FAMILY_PAIRS = sql.raw(
  Object.entries(ALERT_FAMILIES)
    .map(([type, family]) => `('${type}', '${family}')`)
    .join(', '),
);

export const alerts = pgTable(
  'alerts',
  {
    id: id(),
    businessId: ownBusinessId(),
    branchId: uuid('branch_id').notNull(),
    type: text('type').notNull(),
    /**
     * The type's family (`ALERT_FAMILIES`), stored so a partial unique index can say "one open
     * alert per subject and family": low and out of stock are one alert that changes type.
     */
    family: text('family').notNull(),
    subjectType: text('subject_type').notNull(),
    /** The item, batch, customer or entry the alert is about; no foreign key, as its table varies. */
    subjectId: uuid('subject_id').notNull(),
    /** What the bell shows (stock and level for stock alerts), fixed when raised or changed. */
    details: jsonb('details').$type<StockAlertDetails>().notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
    /** Set when the condition ends. A cleared alert is history. */
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('alerts_business_id_id_unique').on(t.businessId, t.id),
    foreignKey({
      name: 'alerts_branch_fk',
      columns: [t.businessId, t.branchId],
      foreignColumns: [branches.businessId, branches.id],
    }),
    // One OPEN alert per subject per branch per family; any number of cleared ones.
    uniqueIndex('alerts_open_unique')
      .on(t.businessId, t.branchId, t.subjectType, t.subjectId, t.family)
      .where(sql`${t.clearedAt} is null`),
    check(
      'alerts_type_family_check',
      sql`(${t.type}, ${t.family}) in (${ALERT_TYPE_FAMILY_PAIRS})`,
    ),
    check('alerts_subject_type_check', sql`${t.subjectType} in (${literals(ALERT_SUBJECT_TYPES)})`),
    check('alerts_details_check', sql`jsonb_typeof(${t.details}) = 'object'`),
    check('alerts_cleared_check', sql`${t.clearedAt} is null or ${t.clearedAt} >= ${t.raisedAt}`),
  ],
);

// A dismissal belongs to one alert row and one person: when the alert clears and a new one is
// raised later, the new one shows again (question 2A). It remembers the type the alert had
// when dismissed, so an alert that gets worse (low to out of stock) shows again but one that
// gets better doesn't (`07` #19). Never deleted; dismissing again updates it.
export const alertDismissals = pgTable(
  'alert_dismissals',
  {
    id: id(),
    businessId: ownBusinessId(),
    alertId: uuid('alert_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** The alert's type when it was dismissed (`ALERT_SEVERITY` says what is worse than it). */
    dismissedType: text('dismissed_type').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    ...tenantPolicies(t.businessId),
    unique('alert_dismissals_alert_user_unique').on(t.businessId, t.alertId, t.userId),
    check('alert_dismissals_type_check', sql`${t.dismissedType} in (${literals(ALERT_TYPES)})`),
    foreignKey({
      name: 'alert_dismissals_alert_fk',
      columns: [t.businessId, t.alertId],
      foreignColumns: [alerts.businessId, alerts.id],
    }),
    foreignKey({
      name: 'alert_dismissals_user_fk',
      columns: [t.businessId, t.userId],
      foreignColumns: [users.businessId, users.id],
    }),
  ],
);
