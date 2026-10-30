-- Every table and sequence the migration role (app_owner) creates in public from now on
-- gives the app's runtime role read, insert and update, and never DELETE or TRUNCATE
-- (ADR 0007 rule 1). Without FOR ROLE this applies to the role running the migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
