-- Creates the two app roles and the app database (ADRs 0006, 0007).
--
-- Run once per PostgreSQL server, by an administrator, with psql:
--   - Docker runs it automatically, but only when the data volume is empty.
--   - Integration tests run it in every throwaway container.
--   - On RDS, the first deploy runs it as the master user (deploy/demo/bootstrap-db.sh).
-- Passwords come from the environment, never from this file.
--
-- It must also work for an administrator who isn't a superuser (RDS's master user):
-- src/bootstrap-rds.test.ts runs it that way. Such an administrator can't change what it
-- doesn't own, and PostgreSQL only WARNs when a GRANT or REVOKE changes nothing, so every
-- change to app_owner's objects happens under SET ROLE app_owner.

\getenv owner_password APP_OWNER_PASSWORD
\getenv runtime_password APP_RUNTIME_PASSWORD

-- Runs migrations and owns every table. Owners skip Row-Level Security,
-- so the app never logs in as this role.
CREATE ROLE app_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- What the app logs in as. Its table grants (no DELETE) come from migration 0000.
CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Passwords in their own statements: if CREATE ROLE fails (say the role exists), the server
-- logs the failing statement, and that must not contain a password.
ALTER ROLE app_owner PASSWORD :'owner_password';
ALTER ROLE app_runtime PASSWORD :'runtime_password';

-- PostgreSQL 16+ lets a non-superuser create a database owned by another role only if it
-- may switch to that role (SET ROLE). INHERIT FALSE: the administrator gets none of
-- app_owner's rights unless it switches on purpose.
GRANT app_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;

-- The app roles have no business in the administrator's own database (the one this script
-- starts in: `postgres` on RDS and locally).
SELECT current_database() AS admin_database \gset
REVOKE CONNECT, TEMPORARY ON DATABASE :"admin_database" FROM PUBLIC;

CREATE DATABASE business_software OWNER app_owner;
SET ROLE app_owner;
REVOKE ALL ON DATABASE business_software FROM PUBLIC;
GRANT CONNECT ON DATABASE business_software TO app_runtime;
-- The administrator too (SESSION_USER: CURRENT_USER is app_owner here), or it couldn't
-- \connect below, run the runbook's manual fixes or take backups.
GRANT CONNECT ON DATABASE business_software TO SESSION_USER;
RESET ROLE;

\connect business_software
SET ROLE app_owner;
-- Already the default since PostgreSQL 15; written out so the intent is visible.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
RESET ROLE;
