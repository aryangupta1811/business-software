// Drizzle table definitions (ADRs 0006, 0027). Every business-owned table uses the helpers
// below; src/tenancy-guard.test.ts fails if a table misses one.
import {
  BUILT_IN_UNITS,
  BUSINESS_TYPES,
  FEATURES,
  GST_RATES,
  GST_STATUSES,
  ITEM_KINDS,
} from '@business-software/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
    // Lower case, trimmed, printable ASCII only: one mailbox has one spelling, so a look-alike
    // letter or a zero-width space can't make a second owner for it (#27).
    check(
      'users_email_check',
      sql`${t.email} = lower(btrim(${t.email})) and ${t.email} ~ '^[!-~]+$'`,
    ),
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
    tenantPolicy(t.businessId),
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
    tenantPolicy(t.businessId),
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
    tenantPolicy(t.businessId),
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
    tenantPolicy(t.businessId),
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
    tenantPolicy(t.businessId),
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
    tenantPolicy(t.businessId),
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
