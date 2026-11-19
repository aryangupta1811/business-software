-- P1.4 login and sessions (Module 00 #21, #27-#29, #34, #37-#44; design
-- docs/plans/2026-11-19-p1.4-login-design.md). The generated part adds the session and device
-- tables and the login columns; the hand-written part at the end adds D4 and the one
-- cross-business read, login by email.
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text,
	"registered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "devices_business_id_token_hash_unique" UNIQUE("business_id","token_hash"),
	CONSTRAINT "devices_token_hash_check" CHECK ("devices"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid,
	"token_hash" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "sessions_business_id_token_hash_unique" UNIQUE("business_id","token_hash"),
	CONSTRAINT "sessions_token_hash_check" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_csrf_hash_check" CHECK ("sessions"."csrf_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_end_reason_check" CHECK ("sessions"."end_reason" in ('logout', 'idle', 'replaced', 'password_changed', 'deactivated', 'reset')),
	CONSTRAINT "sessions_ended_check" CHECK (("sessions"."ended_at" is null) = ("sessions"."end_reason" is null)),
	CONSTRAINT "sessions_user_agent_check" CHECK (length("sessions"."user_agent") <= 200)
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_registered_by_fk" FOREIGN KEY ("business_id","registered_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_fk" FOREIGN KEY ("business_id","device_id") REFERENCES "public"."devices"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_open_by_user" ON "sessions" USING btree ("business_id","user_id") WHERE "sessions"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_username_unique" UNIQUE("business_id","username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_check" CHECK ("users"."username" ~ '^[a-z0-9._-]{3,32}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_username_check" CHECK ("users"."role" <> 'owner' or "users"."username" is null);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "devices" AS PERMISSIVE FOR ALL TO public USING ("devices"."business_id" = (select app_current_business_id())) WITH CHECK ("devices"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING ("sessions"."business_id" = (select app_current_business_id())) WITH CHECK ("sessions"."business_id" = (select app_current_business_id()));--> statement-breakpoint
-- Hand-written (sitting 2, D4 option A; ADR 0028 note): only the database sets an entry's id,
-- business and time. app_runtime may name only the other columns in an INSERT.
REVOKE INSERT ON "entry_log" FROM app_runtime;--> statement-breakpoint
GRANT INSERT ("branch_id", "actor_id", "action", "entity_type", "entity_id", "reason", "before", "after") ON "entry_log" TO app_runtime;--> statement-breakpoint
-- Hand-written: login by email (Module 00 #27) comes before any business is known, and under
-- FORCE RLS even app_owner sees no users without one. So email -> business lives in schema
-- auth, which app_runtime can't use at all (no USAGE). Two SECURITY DEFINER functions are the
-- only way in; both pin search_path and are on the guard's DEFINER_ALLOWED list.
CREATE SCHEMA "auth";--> statement-breakpoint
CREATE TABLE "auth"."owner_logins" (
	"email" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_logins_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "owner_logins_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id"),
	CONSTRAINT "owner_logins_email_check" CHECK ("email" = lower(btrim("email")) and "email" ~ '^[!-~]+$')
);--> statement-breakpoint
-- One owner login by email: its business and user, or no row. Never a password hash.
CREATE FUNCTION "public"."app_find_owner_login"(p_email text)
	RETURNS TABLE (business_id uuid, user_id uuid)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
AS $$ select o.business_id, o.user_id from auth.owner_logins o where o.email = p_email $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."app_find_owner_login"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."app_find_owner_login"(text) TO app_runtime;--> statement-breakpoint
-- Called inside signup's transaction. It runs as app_owner, still under FORCE RLS with the
-- transaction's app.business_id, so it can only see, and register, the current business's
-- owner, with that row's own email: it can't map an email to someone else's business.
CREATE FUNCTION "public"."app_register_owner_login"(p_user_id uuid)
	RETURNS void
	LANGUAGE plpgsql VOLATILE SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
AS $$
begin
	insert into auth.owner_logins (email, business_id, user_id)
	select u.email, u.business_id, u.id from public.users u
	 where u.id = p_user_id and u.role = 'owner';
	if not found then
		raise exception 'no owner % in the current business', p_user_id using errcode = 'P0002';
	end if;
end
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."app_register_owner_login"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."app_register_owner_login"(uuid) TO app_runtime;
