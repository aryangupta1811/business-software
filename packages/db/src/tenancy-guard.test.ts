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
  | 'view';
interface Violation {
  table: string;
  rule: Rule;
}

/** Tables the app may only insert into and read (ADRs 0007, 0028). */
const APPEND_ONLY = ['entry_log'];

/** Schemas that hold no tenant data. `pgboss` joins in P2.7 (ADR 0022). */
const NOT_TENANT_SCHEMAS = [
  'drizzle', // drizzle-kit's migration history; app_runtime can't read it
];

// Every schema except PostgreSQL's own and NOT_TENANT_SCHEMAS (always query parameter $1).
const appSchema = (n: string) =>
  `${n}.nspname <> 'information_schema' and ${n}.nspname not like 'pg\\_%'
   and ${n}.nspname <> all($1::name[])`;

// One row per broken rule. Tables outside public are named with their schema. The policy must
// be the only permissive one (permissive policies are ORed together) and match what
// tenantPolicy() generates, as PostgreSQL prints it back; the tenant column is `id` on
// businesses and business_id everywhere else. has_table_privilege counts grants to PUBLIC and
// to any role app_runtime belongs to. $2 is the append-only list.
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
                    where p.polrelid = t.oid and p.polpermissive and p.polname <> 'tenant_isolation')
        or not exists (
      select 1 from pg_policy p
       where p.polrelid = t.oid and p.polname = 'tenant_isolation'
         and p.polcmd = '*' and p.polpermissive and p.polroles = '{0}'::oid[]
         and pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid)
         and pg_get_expr(p.polqual, p.polrelid) = format(
               '(%I = ( SELECT app_current_business_id() AS app_current_business_id))',
               t.tenant_column))
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
                    where has_table_privilege('app_runtime', t.oid, p))
        -- REFERENCES and UPDATE can also be granted per column.
        or has_any_column_privilege('app_runtime', t.oid, 'REFERENCES')
    union all
    select t.relname, 'append_only' from tables t
     where t.relname = any($2::text[])
       and has_any_column_privilege('app_runtime', t.oid, 'UPDATE')
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

async function findTenancyViolations(pool: Pool, appendOnly = APPEND_ONLY): Promise<Violation[]> {
  const { rows } = await pool.query<Violation>(violationsQuery, [NOT_TENANT_SCHEMAS, appendOnly]);
  return rows;
}

interface FunctionViolation {
  name: string;
  rule: 'definer' | 'function_pin';
}

/** SECURITY DEFINER functions the app may call, each with its reason. None yet (P1.4). */
const DEFINER_ALLOWED: string[] = [];

// The policy function's body exactly as migration 0001 writes it (ADR 0027).
const businessIdFunctionBody =
  " select nullif(current_setting('app.business_id', true), '')::uuid ";

// definer: a SECURITY DEFINER function runs with its owner's rights, so one app_runtime may
// execute (through PUBLIC, a direct grant or a role) is a way around RLS unless it's on
// DEFINER_ALLOWED. function_pin: there must be exactly one app_current_business_id, the
// zero-argument one in public, still a plain STABLE SQL function with its exact body; an
// overload with the right body would otherwise hide a changed original. $2 is that body,
// $3 is DEFINER_ALLOWED.
const functionViolationsQuery = `
  with functions as (
    select p.oid, p.oid::regproc::text as name, p.proname, p.prosecdef, p.provolatile,
           p.prosrc, l.lanname
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

// Membership is how privileges are inherited, so app_runtime belongs to no role.
async function findRoleMemberships(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ rolname: string }>(
    `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
      where m.member = 'app_runtime'::regrole order by r.rolname collate "C"`,
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
  after?: string;
}

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
];

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

  it('keeps app_runtime out of every other role', async () => {
    expect(await findRoleMemberships(owner)).toEqual([]);
  });

  it('reports each broken probe table under the right rule', async () => {
    try {
      await admin.query('create role probe_role');
      await admin.query('grant probe_role to app_runtime');
      await admin.query('create schema probe_schema authorization app_owner');
      for (const probe of probes) await createProbe(owner, probe);
      // RLS never applies to a materialized view: it holds whatever its refresh could see.
      await owner.query('create materialized view probe_matview as select id from branches');
      // A plain view checks the base table's rights as its owner (app_owner), so app_runtime's
      // default UPDATE on the view would update entry_log. security_invoker checks app_runtime.
      await owner.query('create view probe_view as select * from entry_log');
      await owner.query(
        'create view probe_invoker_view with (security_invoker = true) as select * from entry_log',
      );
      const appendOnly = [...APPEND_ONLY, 'probe_append_only', 'probe_column_update'];
      expect(await findTenancyViolations(owner, appendOnly)).toEqual([
        { table: 'probe_append_only', rule: 'append_only' },
        { table: 'probe_branch_fk', rule: 'branch_fk' },
        { table: 'probe_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_column_references', rule: 'privileges' },
        { table: 'probe_column_update', rule: 'append_only' },
        { table: 'probe_delete_grant', rule: 'privileges' },
        { table: 'probe_extra_permissive', rule: 'policy' },
        { table: 'probe_from_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_inherited_delete', rule: 'privileges' },
        { table: 'probe_matview', rule: 'kind' },
        { table: 'probe_no_business_fk', rule: 'business_fk' },
        { table: 'probe_no_business_id', rule: 'business_id' },
        { table: 'probe_no_business_id', rule: 'policy' },
        { table: 'probe_no_force', rule: 'force' },
        { table: 'probe_no_policy', rule: 'policy' },
        { table: 'probe_no_rls', rule: 'rls' },
        { table: 'probe_nullable_business_id', rule: 'business_id' },
        { table: 'probe_public_delete', rule: 'privileges' },
        { table: 'probe_schema.probe_other', rule: 'rls' },
        { table: 'probe_select_policy', rule: 'policy' },
        { table: 'probe_view', rule: 'view' },
        { table: 'probe_wrong_policy', rule: 'policy' },
      ]);
      expect(await findRoleMemberships(owner)).toEqual(['probe_role']);
    } finally {
      await owner.query('drop view if exists probe_view, probe_invoker_view');
      await owner.query('drop materialized view if exists probe_matview');
      await owner.query(`drop table if exists ${probes.map((p) => p.name).join(', ')}`);
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
      expect(await findFunctionViolations(owner)).toEqual([
        { name: 'app_current_business_id', rule: 'definer' },
        { name: 'app_current_business_id', rule: 'function_pin' },
        { name: 'probe_definer', rule: 'definer' },
        { name: 'probe_definer_granted', rule: 'definer' },
      ]);
    } finally {
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
