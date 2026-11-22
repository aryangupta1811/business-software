CREATE TABLE "attendance_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_marks_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "attendance_marks_day_unique" UNIQUE("business_id","user_id","date"),
	CONSTRAINT "attendance_marks_status_check" CHECK ("attendance_marks"."status" in ('present', 'half_day', 'absent', 'paid_leave', 'weekly_off', 'holiday')),
	CONSTRAINT "attendance_marks_present_check" CHECK ("attendance_marks"."status" = 'present' or (not "attendance_marks"."late" and "attendance_marks"."overtime_minutes" = 0)),
	CONSTRAINT "attendance_marks_overtime_check" CHECK ("attendance_marks"."overtime_minutes" between 0 and 720 and "attendance_marks"."overtime_minutes" % 30 = 0),
	CONSTRAINT "attendance_marks_version_check" CHECK ("attendance_marks"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "attendance_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_marks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salary_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_month" date NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_rates_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "salary_rates_kind_check" CHECK ("salary_rates"."kind" in ('monthly', 'daily')),
	CONSTRAINT "salary_rates_amount_check" CHECK ("salary_rates"."amount_paise" > 0),
	CONSTRAINT "salary_rates_month_check" CHECK (extract(day from "salary_rates"."from_month") = 1)
);
--> statement-breakpoint
ALTER TABLE "salary_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salary_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shop_holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_holidays_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "shop_holidays_name_check" CHECK (char_length("shop_holidays"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "shop_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_holidays" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "joining_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_off_day" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paid_leaves_per_month" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "overtime_rate_paise" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- The backfill: staff that exist already (P1.5 logins) joined on the IST day their login was made
-- (design section 3), before the check below, which every staff row must pass. FORCE ROW LEVEL
-- SECURITY filters the migration role too, so the UPDATE would change 0 rows with no error
-- (ADR 0027): it runs between NO FORCE and FORCE inside this transaction, as in 0014.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "users" SET "joining_date" = ("created_at" AT TIME ZONE 'Asia/Kolkata')::date WHERE "role" = 'staff';--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_updated_by_fk" FOREIGN KEY ("business_id","updated_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_rates" ADD CONSTRAINT "salary_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_rates" ADD CONSTRAINT "salary_rates_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_rates" ADD CONSTRAINT "salary_rates_created_by_fk" FOREIGN KEY ("business_id","created_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_holidays" ADD CONSTRAINT "shop_holidays_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_holidays" ADD CONSTRAINT "shop_holidays_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_marks_branch_idx" ON "attendance_marks" USING btree ("business_id","branch_id","date");--> statement-breakpoint
CREATE INDEX "salary_rates_user_idx" ON "salary_rates" USING btree ("business_id","user_id","from_month");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_holidays_live_all_unique" ON "shop_holidays" USING btree ("business_id","date") WHERE "shop_holidays"."branch_id" is null and "shop_holidays"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_holidays_live_branch_unique" ON "shop_holidays" USING btree ("business_id","branch_id","date") WHERE "shop_holidays"."branch_id" is not null and "shop_holidays"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK ("users"."phone" ~ '^[1-9][0-9]{9}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_weekly_off_check" CHECK ("users"."weekly_off_day" between 0 and 6);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_paid_leaves_check" CHECK ("users"."paid_leaves_per_month" between 0 and 31);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_overtime_rate_check" CHECK ("users"."overtime_rate_paise" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_version_check" CHECK ("users"."version" >= 1);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_joining_date_check" CHECK ("users"."role" <> 'staff' or "users"."joining_date" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_record_check" CHECK ("users"."role" <> 'owner' or ("users"."phone" is null and "users"."joining_date" is null and "users"."weekly_off_day" is null and "users"."paid_leaves_per_month" = 0 and "users"."overtime_rate_paise" is null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_marks" AS PERMISSIVE FOR ALL TO public USING ("attendance_marks"."business_id" = (select app_current_business_id())) WITH CHECK ("attendance_marks"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "attendance_marks" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "salary_rates" AS PERMISSIVE FOR ALL TO public USING ("salary_rates"."business_id" = (select app_current_business_id())) WITH CHECK ("salary_rates"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "salary_rates" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shop_holidays" AS PERMISSIVE FOR ALL TO public USING ("shop_holidays"."business_id" = (select app_current_business_id())) WITH CHECK ("shop_holidays"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "shop_holidays" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);
-- A salary rate is never edited (05 #3, ADR 0048): old slips must work out again. DELETE was
-- never granted (0000).
REVOKE UPDATE ON "salary_rates" FROM app_runtime;
