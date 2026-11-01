// Guard test on a throwaway PostgreSQL (ADR 0027): reads the catalogue and fails if any table
// in `public` breaks a tenancy rule, so a table added months from now can't forget RLS.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './testing.js';

type Rule =
  'rls' | 'force' | 'policy' | 'business_id' | 'privileges' | 'branch_fk' | 'tenant_fk' | 'kind';
interface Violation {
  table: string;
  rule: Rule;
}

// One row per broken rule. The policy must be the only permissive one (permissive policies are
// ORed together) and match what tenantPolicy() generates, as PostgreSQL
// prints it back; the tenant column is `id` on businesses and business_id everywhere else.
// Grants to PUBLIC count too: app_runtime gets everything PUBLIC has.
const violationsQuery = `
  with tables as (
    select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity,
           coalesce(c.relacl, acldefault('r', c.relowner)) as acl,
           case when c.relname = 'businesses' then 'id' else 'business_id' end as tenant_column
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
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
     where t.relname <> 'businesses' and not exists (
       select 1 from pg_attribute a
        where a.attrelid = t.oid and a.attname = 'business_id' and not a.attisdropped
          and a.atttypid = 'uuid'::regtype and a.attnotnull)
    union all
    select distinct t.relname, 'privileges' from tables t, aclexplode(t.acl) as acl
     where acl.grantee in ('app_runtime'::regrole::oid, 0)
       and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE')
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
    select c.relname, 'kind' from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('m', 'f')
  ) as violations
  order by relname collate "C", rule collate "C"`;

async function findTenancyViolations(pool: Pool): Promise<Violation[]> {
  const { rows } = await pool.query<Violation>(violationsQuery);
  return rows;
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

  beforeAll(async () => {
    server = await startTestDatabase();
    owner = new Pool({ connectionString: server.ownerUrl });
  });

  afterAll(async () => {
    await owner.end();
    await server.stop();
  });

  it('finds no violations in the real schema', async () => {
    expect(await findTenancyViolations(owner)).toEqual([]);
  });

  it('reports each broken probe table under the right rule', async () => {
    try {
      for (const probe of probes) await createProbe(owner, probe);
      // RLS never applies to a materialized view: it holds whatever its refresh could see.
      await owner.query('create materialized view probe_matview as select id from branches');
      expect(await findTenancyViolations(owner)).toEqual([
        { table: 'probe_branch_fk', rule: 'branch_fk' },
        { table: 'probe_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_delete_grant', rule: 'privileges' },
        { table: 'probe_extra_permissive', rule: 'policy' },
        { table: 'probe_from_branch_fk', rule: 'tenant_fk' },
        { table: 'probe_matview', rule: 'kind' },
        { table: 'probe_no_business_id', rule: 'business_id' },
        { table: 'probe_no_business_id', rule: 'policy' },
        { table: 'probe_no_force', rule: 'force' },
        { table: 'probe_no_policy', rule: 'policy' },
        { table: 'probe_no_rls', rule: 'rls' },
        { table: 'probe_nullable_business_id', rule: 'business_id' },
        { table: 'probe_public_delete', rule: 'privileges' },
        { table: 'probe_select_policy', rule: 'policy' },
        { table: 'probe_wrong_policy', rule: 'policy' },
      ]);
    } finally {
      await owner.query('drop materialized view if exists probe_matview');
      await owner.query(`drop table if exists ${probes.map((p) => p.name).join(', ')}`);
    }
    expect(await findTenancyViolations(owner)).toEqual([]);
  });
});
