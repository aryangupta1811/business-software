ALTER TABLE "businesses" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-written (P1.20, ADR 0016's 2026-11-24 note, decision D5). The one-click demo login comes
-- before any business is known, and under FORCE RLS even app_owner sees no businesses without
-- one. So the list of demo businesses lives in schema auth, which app_runtime can't use at all
-- (no USAGE), like auth.owner_logins. Three SECURITY DEFINER functions are the only way in; all
-- pin search_path and are on the guard's DEFINER_ALLOWED list. No row is ever deleted: a reset
-- builds a new demo business and archives the older ones here.
CREATE TABLE "auth"."demo_businesses" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "demo_businesses_business_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id")
);--> statement-breakpoint
-- Called inside the seed's transaction, once the business is flagged. It runs as app_owner under
-- FORCE RLS with the transaction's app.business_id, so it can only register the current
-- business, and only one that is flagged as a demo.
CREATE FUNCTION "public"."app_register_demo_business"()
	RETURNS void
	LANGUAGE plpgsql VOLATILE SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
AS $$
begin
	insert into auth.demo_businesses (business_id)
	select b.id from public.businesses b where b.demo;
	if not found then
		raise exception 'the current business is not a demo' using errcode = 'P0002';
	end if;
end
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."app_register_demo_business"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."app_register_demo_business"() TO app_runtime;--> statement-breakpoint
-- The newest demo business that hasn't been archived: its ID and when it was made, nothing else.
CREATE FUNCTION "public"."app_find_demo_business"()
	RETURNS TABLE (business_id uuid, created_at timestamp with time zone)
	LANGUAGE sql STABLE SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
AS $$ select d.business_id, d.created_at from auth.demo_businesses d where d.archived_at is null order by d.created_at desc, d.business_id desc limit 1 $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."app_find_demo_business"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."app_find_demo_business"() TO app_runtime;--> statement-breakpoint
-- A reset's last step: every demo business but the new one is hidden from the demo buttons.
-- Archived, never deleted (ADR 0007). Answers how many it archived.
CREATE FUNCTION "public"."app_archive_demo_businesses"(p_keep uuid)
	RETURNS integer
	LANGUAGE plpgsql VOLATILE SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
AS $$
declare
	archived integer;
begin
	update auth.demo_businesses set archived_at = now()
	 where archived_at is null and business_id <> p_keep;
	get diagnostics archived = row_count;
	return archived;
end
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."app_archive_demo_businesses"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."app_archive_demo_businesses"(uuid) TO app_runtime;
