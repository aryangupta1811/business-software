// Guard test on a throwaway PostgreSQL (ADRs 0027, 0028): reads the catalogue and fails if any
// table or function the app can reach breaks a tenancy rule, so a table added months from now
// can't forget RLS.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './testing.js';

type Rule =
  | 'rls'
  | 'force'
  | 'policy'
  | 'business_id'
  | 'business_fk'
  | 'privileges'
  | 'append_only'
  | 'branch_fk'
  | 'tenant_fk'
  | 'kind'
  | 'view'
  | 'backup'
  | 'backup_privileges'
  | 'unique_business'
  | 'fk_valid'
  | 'append_only_missing'
  | 'deletable_missing'
  | 'schema_usage';
interface Violation {
  table: string;
  rule: Rule;
}

/** Tables the app may only insert into and read (ADRs 0007, 0028). */
const APPEND_ONLY = [
  'entry_log',
  'stock_movements',
  'bills',
  'bill_lines',
  'bill_payments',
  'salary_rates',
  'udhaar_entries',
];

/**
 * Permission data the app may DELETE from, and nothing else (ADR 0007's one exception): a
 * staff login's extra branches, removed when the owner unticks one (P1.6). Every change is in
 * the entry log. Any other table with a DELETE grant is a violation.
 */
const DELETABLE = ['staff_branches'];

/**
 * Unique keys on tenant tables without business_id, each on purpose (P1.7 rule
 * `unique_business`). Any other one would let one business's values collide with, and so
 * reveal, another's.
 */
const UNIQUE_WITHOUT_BUSINESS = [
  // Module 00 #27: one owner account per email across the whole app (ADR 0027's 2026-11-18 note).
  'users_owner_email_unique',
];

/**
 * Schemas that hold no tenant data, which app_runtime can't even look into (rule
 * `schema_usage`). `pgboss` joins in P2.7 (ADR 0022). A non-tenant schema the app must use
 * (P1.4's rate-limit counters) needs its own list and rules, not this one.
 */
const NOT_TENANT_SCHEMAS = [
  'drizzle', // drizzle-kit's migration history; app_runtime can't read it
  'auth', // P1.4: owner email -> business for login; app_runtime has no USAGE, only the definers
];

// Every schema except PostgreSQL's own and NOT_TENANT_SCHEMAS (always query parameter $1).
const appSchema = (n: string) =>
  `${n}.nspname <> 'information_schema' and ${n}.nspname not like 'pg\\_%'
   and ${n}.nspname <> all($1::name[])`;

// One row per broken rule. Tables outside public are named with their schema. Permissive
// policies are ORed together, so a table has exactly the two tenantPolicies() generates, as
// PostgreSQL prints them back: tenant_isolation (the tenant column is `id` on businesses and
// business_id everywhere else) and backup_read (ADR 0037: SELECT, every row, app_backup only).
// Without backup_read the nightly pg_dump, which runs with RLS on, would save the table empty.
// has_table_privilege counts grants to PUBLIC and to any role the given role belongs to.
// app_backup may read and nothing else. $2 is the append-only list, $3 UNIQUE_WITHOUT_BUSINESS.
const violationsQuery = `
  with tables as (
    select c.oid, c.oid::regclass::text as relname, c.relrowsecurity, c.relforcerowsecurity,
           case when c.oid = 'businesses'::regclass then 'id' else 'business_id' end
             as tenant_column
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${appSchema('n')} and c.relkind in ('r', 'p')
  ),
  fk_columns as (
    select c.conrelid, c.confrelid,
           array(select a.attname from unnest(c.conkey) with ordinality k(num, i)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
                  order by k.i) as columns,
           array(select a.attname from unnest(c.confkey) with ordinality k(num, i)
                   join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num
                  order by k.i) as referenced
      from pg_constraint c where c.contype = 'f'
  )
  select relname as table, rule from (
    select relname, 'rls' as rule from tables where not relrowsecurity
    union all
    select relname, 'force' from tables where not relforcerowsecurity
    union all
    select t.relname, 'policy' from tables t
     where exists (select 1 from pg_policy p
                    where p.polrelid = t.oid and p.polpermissive
                      and p.polname not in ('tenant_isolation', 'backup_read'))
        or not exists (
      select 1 from pg_policy p
       where p.polrelid = t.oid and p.polname = 'tenant_isolation'
         and p.polcmd = '*' and p.polpermissive and p.polroles = '{0}'::oid[]
         and pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid)
         and pg_get_expr(p.polqual, p.polrelid) = format(
               '(%I = ( SELECT app_current_business_id() AS app_current_business_id))',
               t.tenant_column))
    union all
    select t.relname, 'backup' from tables t
     where not exists (
      select 1 from pg_policy p
       where p.polrelid = t.oid and p.polname = 'backup_read'
         and p.polcmd = 'r' and p.polpermissive and p.polroles = array['app_backup'::regrole::oid]
         and pg_get_expr(p.polqual, p.polrelid) = 'true' and p.polwithcheck is null)
    union all
    select t.relname, 'backup_privileges' from tables t
     where exists (select 1 from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                              'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
                    where has_table_privilege('app_backup', t.oid, p))
        or exists (select 1 from unnest(array['INSERT', 'UPDATE', 'REFERENCES']) as p
                    where has_any_column_privilege('app_backup', t.oid, p))
    union all
    select t.relname, 'business_id' from tables t
     where t.oid <> 'businesses'::regclass and not exists (
       select 1 from pg_attribute a
        where a.attrelid = t.oid and a.attname = 'business_id' and not a.attisdropped
          and a.atttypid = 'uuid'::regtype and a.attnotnull)
    union all
    select t.relname, 'business_fk' from tables t
     where t.oid <> 'businesses'::regclass
       and exists (select 1 from pg_attribute a
                    where a.attrelid = t.oid and a.attname = 'business_id' and not a.attisdropped)
       and not exists (select 1 from fk_columns f
                        where f.conrelid = t.oid and f.confrelid = 'businesses'::regclass
                          and f.columns = array['business_id']::name[]
                          and f.referenced = array['id']::name[])
    union all
    select t.relname, 'privileges' from tables t
     where exists (select 1 from unnest(array['DELETE', 'TRUNCATE', 'TRIGGER', 'MAINTAIN']) as p
                    where has_table_privilege('app_runtime', t.oid, p)
                      and not (p = 'DELETE' and t.relname = any($4::text[])))
        -- REFERENCES and UPDATE can also be granted per column.
        or has_any_column_privilege('app_runtime', t.oid, 'REFERENCES')
    union all
    -- An append-only table's partitions are append-only too: rows can be updated through them.
    select t.relname, 'append_only' from tables t
     where t.oid in (select to_regclass(l.name) from unnest($2::text[]) as l(name)
                     union all
                     -- pg_partition_tree lists nothing for a table that isn't partitioned.
                     select p.relid from unnest($2::text[]) as l(name)
                       cross join lateral pg_partition_tree(to_regclass(l.name)) as p)
       and has_any_column_privilege('app_runtime', t.oid, 'UPDATE')
    union all
    -- A misspelt or renamed name would otherwise protect nothing, silently.
    select l.name, 'append_only_missing' from unnest($2::text[]) as l(name)
     where to_regclass(l.name) is null
    union all
    -- A misspelt or renamed name would otherwise exempt nothing, silently.
    select l.name, 'deletable_missing' from unnest($4::text[]) as l(name)
     where to_regclass(l.name) is null
    union all
    select t.relname, 'branch_fk' from tables t
     where exists (select 1 from pg_attribute a
                    where a.attrelid = t.oid and a.attname = 'branch_id' and not a.attisdropped)
       and not exists (select 1 from fk_columns f
                        where f.conrelid = t.oid and f.confrelid = 'branches'::regclass
                          and f.columns = array['business_id', 'branch_id']::name[]
                          and f.referenced = array['business_id', 'id']::name[])
    union all
    -- Every key into another tenant table must pair business_id with business_id.
    select distinct t.relname, 'tenant_fk' from tables t
      join fk_columns f on f.conrelid = t.oid
     where f.confrelid <> 'businesses'::regclass
       and exists (select 1 from pg_attribute a
                    where a.attrelid = f.confrelid and a.attname = 'business_id' and not a.attisdropped)
       and coalesce(array_position(f.columns, 'business_id'::name)
                    = array_position(f.referenced, 'business_id'::name), false) = false
    union all
    -- Unique keys see every row, whatever RLS hides: without business_id, one business's
    -- values collide with another's, and the error tells it they exist.
    select distinct t.relname, 'unique_business' from tables t
      join pg_index i on i.indrelid = t.oid
     where i.indisunique and not i.indisprimary and t.oid <> 'businesses'::regclass
       and i.indexrelid::regclass::text <> all($3::text[])
       and not exists (select 1 from pg_attribute a
                        where a.attrelid = t.oid and a.attname = 'business_id'
                          and a.attnum = any(i.indkey::int2[]))
    union all
    -- A NOT VALID key never checked the rows that were there when it was added.
    select distinct t.relname, 'fk_valid' from tables t
      join pg_constraint c on c.conrelid = t.oid
     where c.contype = 'f' and not c.convalidated
    union all
    select n.nspname::text, 'schema_usage' from pg_namespace n
     where n.nspname = any($1::name[]) and has_schema_privilege('app_runtime', n.oid, 'USAGE')
    union all
    -- RLS never applies to these, so they can't hold tenant data.
    select c.oid::regclass::text, 'kind' from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where ${appSchema('n')} and c.relkind in ('m', 'f')
    union all
    -- A plain view checks its base tables' rights as the view's owner, app_owner, so writing
    -- through it would skip app_runtime's missing UPDATE and DELETE. security_invoker checks
    -- the caller instead.
    select c.oid::regclass::text, 'view' from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where ${appSchema('n')} and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any(c.reloptions), false)
  ) as violations
  order by relname collate "C", rule collate "C"`;

async function findTenancyViolations(
  pool: Pool,
  appendOnly = APPEND_ONLY,
  deletable = DELETABLE,
): Promise<Violation[]> {
  const { rows } = await pool.query<Violation>(violationsQuery, [
    NOT_TENANT_SCHEMAS,
    appendOnly,
    UNIQUE_WITHOUT_BUSINESS,
    deletable,
  ]);
  return rows;
}

interface FunctionViolation {
  name: string;
  rule: 'definer' | 'definer_search_path' | 'function_pin';
}

/** SECURITY DEFINER functions the app may call, each with its reason. */
const DEFINER_ALLOWED: string[] = [
  // P1.4: login by email comes before any business is known; returns two IDs, never a hash.
  'app_find_owner_login',
  // P1.4: signup registers its own owner's email; RLS limits it to the current business.
  'app_register_owner_login',
  // P1.20: the one-click demo login and the demo reset come before any business is known. The
  // three return or archive only demo businesses' IDs and times, never a row of tenant data.
  'app_register_demo_business',
  'app_find_demo_business',
  'app_archive_demo_businesses',
];

// The policy function's body exactly as migration 0001 writes it (ADR 0027).
const businessIdFunctionBody =
  " select nullif(current_setting('app.business_id', true), '')::uuid ";

// definer: a SECURITY DEFINER function runs with its owner's rights, so one app_runtime may
// execute (through PUBLIC, a direct grant or a role) is a way around RLS unless it's on
// DEFINER_ALLOWED. function_pin: there must be exactly one app_current_business_id, the
// zero-argument one in public, still a plain STABLE SQL function with its exact body; an
// overload with the right body would otherwise hide a changed original. $2 is that body,
// $3 is DEFINER_ALLOWED. definer_search_path: every SECURITY DEFINER function the app may run
// pins search_path, so an object the caller creates can't stand in for one the function names.
const functionViolationsQuery = `
  with functions as (
    select p.oid, p.oid::regproc::text as name, p.proname, p.prosecdef, p.provolatile,
           p.prosrc, p.proconfig, l.lanname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where ${appSchema('n')}
  )
  select name, rule from (
    select f.name, 'definer' as rule from functions f
     where f.prosecdef and has_function_privilege('app_runtime', f.oid, 'EXECUTE')
       and f.name <> all($3::text[])
    union all
    select f.name, 'definer_search_path' from functions f
     where f.prosecdef and has_function_privilege('app_runtime', f.oid, 'EXECUTE')
       and not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%')
    union all
    select 'app_current_business_id', 'function_pin'
     where (select count(*) from functions f where f.proname = 'app_current_business_id') <> 1
        or not exists (select 1 from functions f
                        where f.oid = to_regprocedure('public.app_current_business_id()')
                          and not f.prosecdef and f.provolatile = 's' and f.lanname = 'sql'
                          and f.prosrc = $2)
  ) as violations
  order by name collate "C", rule collate "C"`;

async function findFunctionViolations(pool: Pool): Promise<FunctionViolation[]> {
  const { rows } = await pool.query<FunctionViolation>(functionViolationsQuery, [
    NOT_TENANT_SCHEMAS,
    businessIdFunctionBody,
    DEFINER_ALLOWED,
  ]);
  return rows;
}

/** Columns only the database fills, never app_runtime (sitting 2, D4; ADR 0028 note). */
const DATABASE_SET_COLUMNS: Record<string, string[]> = {
  entry_log: ['id', 'business_id', 'created_at'],
};

// table.column pairs where app_runtime may INSERT or UPDATE a database-set column.
async function findDatabaseSetColumnGrants(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `select t.table_name || '.' || c.column_name as name
       from jsonb_each($1::jsonb) t(table_name, columns),
            jsonb_array_elements_text(t.columns) c(column_name)
      where has_column_privilege('app_runtime', t.table_name::regclass, c.column_name, 'INSERT')
         or has_column_privilege('app_runtime', t.table_name::regclass, c.column_name, 'UPDATE')
      order by (t.table_name || '.' || c.column_name) collate "C"`,
    [JSON.stringify(DATABASE_SET_COLUMNS)],
  );
  return rows.map((row) => row.name);
}

// Membership is how privileges are inherited, so app_runtime belongs to no role.
async function findRoleMemberships(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ rolname: string }>(
    `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
      where m.member = 'app_runtime'::regrole order by r.rolname collate "C"`,
  );
  return rows.map((row) => row.rolname);
}

// A role that inherits app_backup, or may SET ROLE to it, reads every business (ADR 0037).
// A membership with neither (the ADMIN-only one PostgreSQL 16+ gives a non-superuser that
// creates the role, like RDS's master user) passes on no rights.
async function findBackupMembers(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ rolname: string }>(
    `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.member
      where m.roleid = 'app_backup'::regrole and (m.inherit_option or m.set_option)
      order by r.rolname collate "C"`,
  );
  return rows.map((row) => row.rolname);
}

const tenantColumn = 'business_id uuid not null references businesses(id)';
const check = (column: string) => `${column} = (select app_current_business_id())`;
const correctPolicy = (column = 'business_id') =>
  `for all to public using (${check(column)}) with check (${check(column)})`;

interface Probe {
  name: string;
  columns?: string;
  enable?: boolean;
  force?: boolean;
  /** The policy after `AS PERMISSIVE`, or null for none. */
  policy?: string | null;
  /** The backup_read policy after `AS PERMISSIVE`, or null for none. */
  backup?: string | null;
  after?: string;
}

const correctBackupPolicy = 'for select to app_backup using (true)';

// Each probe is a correct tenant table with exactly one thing broken.
const probes: Probe[] = [
  { name: 'probe_no_rls', enable: false },
  { name: 'probe_no_force', force: false },
  { name: 'probe_no_policy', policy: null },
  { name: 'probe_wrong_policy', policy: 'for all using (true) with check (true)' },
  { name: 'probe_select_policy', policy: `for select using (${check('business_id')})` },
  { name: 'probe_no_business_id', columns: '', policy: correctPolicy('id') },
  { name: 'probe_nullable_business_id', columns: 'business_id uuid references businesses(id)' },
  { name: 'probe_delete_grant', after: 'grant delete on probe_delete_grant to app_runtime' },
  { name: 'probe_public_delete', after: 'grant delete on probe_public_delete to public' },
  { name: 'probe_branch_fk', columns: `${tenantColumn}, branch_id uuid references branches(id)` },
  // Permissive policies are ORed together: one more `using (true)` would show every business.
  {
    name: 'probe_extra_permissive',
    after:
      'create policy reporting on probe_extra_permissive as permissive for select using (true)',
  },
  // Restrictive policies only narrow what tenant_isolation allows.
  {
    name: 'probe_extra_restrictive',
    after: 'create policy narrow on probe_extra_restrictive as restrictive for all using (true)',
  },
  // Foreign-key checks skip RLS, so a single-column key could point at another business's row.
  {
    name: 'probe_from_branch_fk',
    columns: `${tenantColumn}, from_branch_id uuid references branches(id)`,
  },
  {
    name: 'probe_good_from_branch_fk',
    columns: `${tenantColumn}, from_branch_id uuid,
      foreign key (business_id, from_branch_id) references branches(business_id, id)`,
  },
  {
    name: 'probe_good_branch_fk',
    columns: `${tenantColumn}, branch_id uuid,
      foreign key (business_id, branch_id) references branches(business_id, id)`,
  },
  // Without the key, business_id could name a business that doesn't exist.
  { name: 'probe_no_business_fk', columns: 'business_id uuid not null' },
  // Checked with this probe added to the append-only list.
  { name: 'probe_append_only' },
  // app_runtime gets what probe_role has: an inherited DELETE is still a DELETE.
  {
    name: 'probe_inherited_delete',
    after: 'grant delete on probe_inherited_delete to probe_role',
  },
  // A column-level grant is still UPDATE. Checked with this probe on the append-only list.
  {
    name: 'probe_column_update',
    after: `revoke update on probe_column_update from app_runtime;
            grant update (id) on probe_column_update to app_runtime`,
  },
  {
    name: 'probe_column_references',
    after: 'grant references (id) on probe_column_references to app_runtime',
  },
  // Tenant tables outside public are checked too.
  { name: 'probe_schema.probe_other', enable: false },
  // pg_dump with RLS on would save this table with no rows (ADR 0037).
  { name: 'probe_no_backup_policy', backup: null },
  // Every role, app_runtime included, would read every business.
  { name: 'probe_backup_to_public', backup: 'for select to public using (true)' },
  { name: 'probe_backup_for_all', backup: 'for all to app_backup using (true)' },
  {
    name: 'probe_backup_filtered',
    backup: `for select to app_backup using (${check('business_id')})`,
  },
  { name: 'probe_backup_insert', after: 'grant insert on probe_backup_insert to app_backup' },
  {
    name: 'probe_backup_column_update',
    after: 'grant update (id) on probe_backup_column_update to app_backup',
  },
  // P1.7: a unique key without business_id, as a constraint or an expression index.
  { name: 'probe_unique_no_business', columns: `${tenantColumn}, code text unique` },
  {
    name: 'probe_unique_expression',
    columns: `${tenantColumn}, code text`,
    after:
      'create unique index probe_unique_expression_code on probe_unique_expression (lower(code))',
  },
  {
    name: 'probe_good_unique',
    columns: `${tenantColumn}, code text, unique (business_id, code)`,
    after: `create unique index probe_good_unique_lower on probe_good_unique (business_id, lower(code))
              where code is not null`,
  },
  // A key added NOT VALID passes business_fk but never checked the rows already there.
  {
    name: 'probe_fk_not_valid',
    columns: 'business_id uuid not null',
    after:
      'alter table probe_fk_not_valid add foreign key (business_id) references businesses(id) not valid',
  },
];

// A partitioned tenant table on the append-only list whose partition still has UPDATE.
const partitionedProbe = `
  create table probe_parted (id uuid not null, business_id uuid not null references businesses(id),
    primary key (business_id, id)) partition by list (business_id);
  create table probe_parted_one partition of probe_parted default;
  alter table probe_parted enable row level security;
  alter table probe_parted force row level security;
  create policy tenant_isolation on probe_parted as permissive ${correctPolicy()};
  create policy backup_read on probe_parted as permissive ${correctBackupPolicy};
  alter table probe_parted_one enable row level security;
  alter table probe_parted_one force row level security;
  create policy tenant_isolation on probe_parted_one as permissive ${correctPolicy()};
  create policy backup_read on probe_parted_one as permissive ${correctBackupPolicy};
  revoke update on probe_parted from app_runtime`;

async function createProbe(owner: Pool, probe: Probe): Promise<void> {
  const columns = probe.columns ?? tenantColumn;
  await owner.query(
    `create table ${probe.name} (id uuid primary key${columns ? `, ${columns}` : ''})`,
  );
  if (probe.enable ?? true)
    await owner.query(`alter table ${probe.name} enable row level security`);
  if (probe.force ?? true) await owner.query(`alter table ${probe.name} force row level security`);
  const policy = probe.policy === undefined ? correctPolicy() : probe.policy;
  if (policy !== null) {
    await owner.query(`create policy tenant_isolation on ${probe.name} as permissive ${policy}`);
  }
  const backup = probe.backup === undefined ? correctBackupPolicy : probe.backup;
  if (backup !== null) {
    await owner.query(`create policy backup_read on ${probe.name} as permissive ${backup}`);
  }
  if (probe.after) await owner.query(probe.after);
}

describe('tenancy guard', () => {
  let server: TestDatabase;
  let owner: Pool;
  // The container's superuser: app_owner can't create roles or schemas.
  let admin: Pool;

  beforeAll(async () => {
    server = await startTestDatabase();
    owner = new Pool({ connectionString: server.ownerUrl });
    admin = new Pool({ connectionString: server.adminUrl });
  });

  afterAll(async () => {
    await owner.end();
    await admin.end();
    await server.stop();
  });

  it('finds no violations in the real schema', async () => {
    expect(await findTenancyViolations(owner)).toEqual([]);
  });

  it('finds no unsafe or changed functions in the real schema', async () => {
    expect(await findFunctionViolations(owner)).toEqual([]);
  });

  it('leaves database-set columns to the database', async () => {
    expect(await findDatabaseSetColumnGrants(owner)).toEqual([]);
    try {
      await owner.query('grant insert (created_at) on entry_log to app_runtime');
      expect(await findDatabaseSetColumnGrants(owner)).toEqual(['entry_log.created_at']);
    } finally {
      await owner.query('revoke insert (created_at) on entry_log from app_runtime');
    }
    expect(await findDatabaseSetColumnGrants(owner)).toEqual([]);
  });

  it('keeps app_runtime out of every other role', async () => {
    expect(await findRoleMemberships(owner)).toEqual([]);
  });

  it('lets no role use the backup role', async () => {
    expect(await findBackupMembers(owner)).toEqual([]);
  });

  it('reports a role that can use the backup role', async () => {
    try {
      await admin.query('create role probe_backup_member');
      // ADMIN alone passes on no rights: the membership RDS's master user gets.
      await admin.query(
        'grant app_backup to probe_backup_member with admin true, inherit false, set false',
      );
      expect(await findBackupMembers(owner)).toEqual([]);
      await admin.query('grant app_backup to probe_backup_member with inherit true');
      expect(await findBackupMembers(owner)).toEqual(['probe_backup_member']);
      await admin.query('grant app_backup to probe_backup_member with inherit false, set true');
      expect(await findBackupMembers(owner)).toEqual(['probe_backup_member']);
    } finally {
      await admin.query('drop role if exists probe_backup_member');
    }
  });

  it('reports each broken probe table under the right rule', async () => {
    try {
      await admin.query('create role probe_role');
      await admin.query('grant probe_role to app_runtime');
      await admin.query('create schema probe_schema authorization app_owner');
      for (const probe of probes) await createProbe(owner, probe);
      await owner.query(partitionedProbe);
      // drizzle's schema holds migration history, not tenant data: the app needn't see it.
      await owner.query('grant usage on schema drizzle to app_runtime');
      // RLS never applies to a materialized view: it holds whatever its refresh could see.
      await owner.query('create materialized view probe_matview as select id from branches');
      // A plain view checks the base table's rights as its owner (app_owner), so app_runtime's
      // default UPDATE on the view would update entry_log. security_invoker checks app_runtime.
      await owner.query('create view probe_view as select * from entry_log');
      await owner.query(
        'create view probe_invoker_view with (security_invoker = true) as select * from entry_log',
      );
      const appendOnly = [
        ...APPEND_ONLY,
        'probe_append_only',
        'probe_column_update',
        'probe_parted',
        'probe_missing',
      ];
      const deletable = [...DELETABLE, 'probe_missing_delete'];
      expect(await findTenancyViolations(owner, appendOnly, deletable)).toEqual([
        { table: 'drizzle', rule: 'schema_usage' },
        { table: 'probe_append_only', rule: 'append_only' },
        { table: 'probe_backup_column_update', rule: 'backup_privileges' },
        { table: 'probe_backup_filtered', rule: 'backup' },
        { table: 'probe_backup_for_all', rule: 'backup' },
        { table: 'probe_backup_insert', rule: 'backup_privileges' },
        { table: 'probe_backup_to_public', rule: 'backup' },
        { table: 'probe_branch_fk', rule: 'branch_fk' },
        { table: 'probe_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_column_references', rule: 'privileges' },
        { table: 'probe_column_update', rule: 'append_only' },
        { table: 'probe_delete_grant', rule: 'privileges' },
        { table: 'probe_extra_permissive', rule: 'policy' },
        { table: 'probe_fk_not_valid', rule: 'fk_valid' },
        { table: 'probe_from_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_inherited_delete', rule: 'privileges' },
        { table: 'probe_matview', rule: 'kind' },
        { table: 'probe_missing', rule: 'append_only_missing' },
        { table: 'probe_missing_delete', rule: 'deletable_missing' },
        { table: 'probe_no_backup_policy', rule: 'backup' },
        { table: 'probe_no_business_fk', rule: 'business_fk' },
        { table: 'probe_no_business_id', rule: 'business_id' },
        { table: 'probe_no_business_id', rule: 'policy' },
        { table: 'probe_no_force', rule: 'force' },
        { table: 'probe_no_policy', rule: 'policy' },
        { table: 'probe_no_rls', rule: 'rls' },
        { table: 'probe_nullable_business_id', rule: 'business_id' },
        { table: 'probe_parted_one', rule: 'append_only' },
        // PUBLIC is every role, the backup role too.
        { table: 'probe_public_delete', rule: 'backup_privileges' },
        { table: 'probe_public_delete', rule: 'privileges' },
        { table: 'probe_schema.probe_other', rule: 'rls' },
        { table: 'probe_select_policy', rule: 'policy' },
        { table: 'probe_unique_expression', rule: 'unique_business' },
        { table: 'probe_unique_no_business', rule: 'unique_business' },
        { table: 'probe_view', rule: 'view' },
        { table: 'probe_wrong_policy', rule: 'policy' },
      ]);
      expect(await findRoleMemberships(owner)).toEqual(['probe_role']);
    } finally {
      await owner.query('drop view if exists probe_view, probe_invoker_view');
      await owner.query('drop materialized view if exists probe_matview');
      await owner.query(`drop table if exists ${probes.map((p) => p.name).join(', ')}`);
      await owner.query('drop table if exists probe_parted');
      await owner.query('revoke usage on schema drizzle from app_runtime');
      await admin.query('drop schema if exists probe_schema cascade');
      await admin.query('revoke probe_role from app_runtime');
      await admin.query('drop role if exists probe_role');
    }
    expect(await findTenancyViolations(owner)).toEqual([]);
    expect(await findRoleMemberships(owner)).toEqual([]);
  });

  // A SECURITY DEFINER function runs with its owner's rights, so one the app can call is a way
  // around RLS, whether it reaches app_runtime through PUBLIC or a direct grant. Making the real
  // policy function one must trip both rules.
  it('reports unsafe and changed functions', async () => {
    try {
      await owner.query(
        "create function probe_definer() returns int language sql security definer as 'select 1'",
      );
      await owner.query(`
        create function probe_definer_granted() returns int language sql security definer
          as 'select 1';
        revoke execute on function probe_definer_granted() from public;
        grant execute on function probe_definer_granted() to app_runtime`);
      await owner.query('alter function app_current_business_id() security definer');
      // Allowed, but no longer pinned.
      await owner.query('alter function app_find_owner_login(text) reset search_path');
      expect(await findFunctionViolations(owner)).toEqual([
        { name: 'app_current_business_id', rule: 'definer' },
        { name: 'app_current_business_id', rule: 'definer_search_path' },
        { name: 'app_current_business_id', rule: 'function_pin' },
        { name: 'app_find_owner_login', rule: 'definer_search_path' },
        { name: 'probe_definer', rule: 'definer' },
        { name: 'probe_definer', rule: 'definer_search_path' },
        { name: 'probe_definer_granted', rule: 'definer' },
        { name: 'probe_definer_granted', rule: 'definer_search_path' },
      ]);
    } finally {
      await owner.query(
        'alter function app_find_owner_login(text) set search_path = pg_catalog, pg_temp',
      );
      await owner.query('alter function app_current_business_id() security invoker');
      await owner.query('drop function if exists probe_definer(), probe_definer_granted()');
    }
    expect(await findFunctionViolations(owner)).toEqual([]);
  });

  // With a correct overload present, a check by name alone passes while the real one is changed.
  it('pins the one app_current_business_id(), not any function of that name', async () => {
    try {
      await owner.query(
        `create function app_current_business_id(x int) returns uuid language sql stable
           as $$${businessIdFunctionBody}$$`,
      );
      expect(await findFunctionViolations(owner)).toEqual([
        { name: 'app_current_business_id', rule: 'function_pin' },
      ]);
    } finally {
      await owner.query('drop function if exists app_current_business_id(int)');
    }
    expect(await findFunctionViolations(owner)).toEqual([]);
  });
});
