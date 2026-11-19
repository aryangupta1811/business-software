-- Creates the backup role app_backup (ADR 0037): it may read every row of the app database
-- and change nothing. Nightly pg_dump logs in as it (deploy/demo/backup.sh).
--
-- Why a role of its own: tenant tables FORCE Row-Level Security, so only a superuser or a
-- BYPASSRLS role reads all of them, and RDS's master user is neither (AWS lists Bypass RLS
-- only on rdsadmin). Instead, every tenant table has a policy `backup_read`: SELECT for this
-- role, every row (packages/db/src/schema.ts, checked by src/tenancy-guard.test.ts). Its table
-- grants (SELECT only) come from migration 0007.
--
-- Safe to run more than once: it creates the role only when missing, and sets everything else
-- on every run, so a run that stopped half-way, or a new password in SSM, is put right by the
-- next one. Run after create-roles.sql, by the same administrator:
--   - Docker and the tests run it as 20-create-backup-role.sql, after 10-create-roles.sql.
--   - On RDS, deploy/demo/bootstrap-db.sh runs it on every deploy, so a database made before
--     this file existed gets the role before migration 0007 needs it.
-- The password comes from APP_BACKUP_PASSWORD. Without it the role can't log in with a
-- password (fine on a laptop, where only the local superuser takes backups).

\getenv backup_password APP_BACKUP_PASSWORD

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backup') AS create_backup_role
\gset

\if :create_backup_role
  -- NOBYPASSRLS on purpose: the backup_read policies decide what it sees, so a table that
  -- forgot its policy fails the guard test instead of being silently readable.
  CREATE ROLE app_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\endif

\if :{?backup_password}
  -- Its own statement, like create-roles.sql: a failing CREATE ROLE is logged, this isn't.
  ALTER ROLE app_backup PASSWORD :'backup_password';
\endif
-- Read-only even if a grant slips through: every transaction starts READ ONLY.
ALTER ROLE app_backup SET default_transaction_read_only = on;
-- The database belongs to app_owner; a non-superuser admin (RDS) may only grant on it as
-- app_owner, and PostgreSQL would just WARN otherwise.
SET ROLE app_owner;
GRANT CONNECT ON DATABASE business_software TO app_backup;
RESET ROLE;
