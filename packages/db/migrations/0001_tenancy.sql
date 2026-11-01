-- Hand-written (ADR 0027): the business this transaction works for, set by withBusiness with
-- set_config(..., true). NULL when none is set, so policies match no rows. nullif because a
-- transaction-local setting reads back as '' (not NULL) on the same connection afterwards,
-- and ''::uuid would throw. Not SECURITY DEFINER: it runs with the caller's own rights.
CREATE FUNCTION app_current_business_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.business_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_business_id_id_unique" UNIQUE("business_id","id")
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branches" AS PERMISSIVE FOR ALL TO public USING ("branches"."business_id" = (select app_current_business_id())) WITH CHECK ("branches"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "businesses" AS PERMISSIVE FOR ALL TO public USING ("businesses"."id" = (select app_current_business_id())) WITH CHECK ("businesses"."id" = (select app_current_business_id()));