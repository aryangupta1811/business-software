-- Creates the queue role app_queue and the schema it owns, pgboss (ADR 0022). The worker's job
-- queue (pg-boss) logs in as it: it creates its tables and deletes finished jobs, but only in
-- its own schema, and it can't read a single business table.
--
-- Safe to run more than once, like create-backup-role.sql: it creates the role and the schema
-- only when missing, and sets the password on every run. Run after create-roles.sql, by the
-- same administrator:
--   - Docker and the tests run it as 30-create-queue-role.sql.
--   - On RDS it must run once by hand (or from deploy/demo/bootstrap-db.sh) before the worker
--     that uses the queue is deployed: create-roles.sql is skipped there once the database exists.
-- The password comes from APP_QUEUE_PASSWORD. Without it the role can't log in with a password.

\getenv queue_password APP_QUEUE_PASSWORD

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_queue') AS create_queue_role
\gset

\if :create_queue_role
  -- No BYPASSRLS: it has no business with business tables, and RLS is a second wall.
  CREATE ROLE app_queue LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\endif

\if :{?queue_password}
  -- Its own statement, like create-roles.sql: a failing CREATE ROLE is logged, this isn't.
  ALTER ROLE app_queue PASSWORD :'queue_password';
\endif

-- The schema must be owned by app_queue, and PostgreSQL 16+ lets only a role that may switch
-- to it create a schema for it. The database belongs to app_owner, so app_owner creates the
-- schema; the administrator lends it app_queue for exactly this and takes it back.
-- (pg-boss starts with createSchema: false, so it never needs CREATE on the database.)
GRANT app_queue TO app_owner WITH INHERIT FALSE, SET TRUE;
SET ROLE app_owner;
GRANT CONNECT ON DATABASE business_software TO app_queue;
RESET ROLE;

\connect business_software
SELECT NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') AS create_queue_schema
\gset
\if :create_queue_schema
  SET ROLE app_owner;
  CREATE SCHEMA pgboss AUTHORIZATION app_queue;
  RESET ROLE;
\endif
REVOKE app_queue FROM app_owner;
