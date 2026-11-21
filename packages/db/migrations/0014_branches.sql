-- P1.6 branches. `branches.code` (the short name in invoice numbers) and `archived_at`, and
-- `staff_branches`: the extra branches a staff login may work at.
--
-- The backfill. FORCE ROW LEVEL SECURITY filters the migration role too, so an UPDATE here would
-- change 0 rows with no error (ADR 0027), leave `code` null, and make SET NOT NULL fail. So the
-- backfill runs between NO FORCE and FORCE inside this transaction (DDL is transactional). Each
-- business's oldest branch (its head office) becomes 'HO'; any further branch, which signup never
-- made but a restored dump might hold, becomes B2, B3, ... so the unique key can hold.
ALTER TABLE "branches" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branches" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "branches" SET "code" = CASE WHEN "ranked"."position" = 1 THEN 'HO' ELSE 'B' || "ranked"."position" END
  FROM (SELECT "id", row_number() OVER (PARTITION BY "business_id" ORDER BY "created_at", "id") AS "position" FROM "branches") AS "ranked"
  WHERE "branches"."id" = "ranked"."id";--> statement-breakpoint
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "staff_branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_branches_business_id_user_id_branch_id_unique" UNIQUE("business_id","user_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "staff_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_branches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The one table the app may delete from: unticking a branch removes its row. It is permission
-- data, not a business record, and each change is in the entry log (design section 5).
GRANT DELETE ON "staff_branches" TO app_runtime;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_end_reason_check";--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_code_unique" UNIQUE("business_id","code");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_code_check" CHECK ("branches"."code" ~ '^[A-Z0-9]{1,6}$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_end_reason_check" CHECK ("sessions"."end_reason" in ('logout', 'idle', 'replaced', 'password_changed', 'deactivated', 'reset', 'device_forgotten', 'device_moved', 'branch_removed'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_branches" AS PERMISSIVE FOR ALL TO public USING ("staff_branches"."business_id" = (select app_current_business_id())) WITH CHECK ("staff_branches"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "staff_branches" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);
