-- Creates the two app roles and the app database (ADRs 0006, 0007).
--
-- Run once per PostgreSQL server, by an administrator, with psql:
--   - Docker runs it automatically, but only when the data volume is empty.
--   - Integration tests run it in every throwaway container.
--   - On RDS it is run by hand at DevOps stage 5.
-- Passwords come from the environment, never from this file.

\getenv owner_password APP_OWNER_PASSWORD
\getenv runtime_password APP_RUNTIME_PASSWORD

-- Runs migrations and owns every table. Owners skip Row-Level Security,
-- so the app never logs in as this role.
CREATE ROLE app_owner LOGIN PASSWORD :'owner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- What the app logs in as. Its table grants (no DELETE) come from migration 0000.
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE business_software OWNER app_owner;
REVOKE ALL ON DATABASE business_software FROM PUBLIC;
GRANT CONNECT ON DATABASE business_software TO app_runtime;

\connect business_software
-- Already the default since PostgreSQL 15; written out so the intent is visible.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
