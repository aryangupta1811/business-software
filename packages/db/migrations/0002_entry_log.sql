CREATE TABLE "entry_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "entry_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_log" ADD CONSTRAINT "entry_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_log" ADD CONSTRAINT "entry_log_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "entry_log" AS PERMISSIVE FOR ALL TO public USING ("entry_log"."business_id" = (select app_current_business_id())) WITH CHECK ("entry_log"."business_id" = (select app_current_business_id()));--> statement-breakpoint
-- Hand-written (ADRs 0007, 0028): the log is append-only. 0000's default privileges granted
-- UPDATE at CREATE TABLE; DELETE and TRUNCATE were never granted.
REVOKE UPDATE ON "entry_log" FROM app_runtime;