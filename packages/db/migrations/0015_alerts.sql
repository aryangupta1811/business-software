CREATE TABLE "alert_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_dismissals_alert_user_unique" UNIQUE("business_id","alert_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "alert_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_dismissals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" text NOT NULL,
	"family" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"details" jsonb NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "alerts_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "alerts_type_family_check" CHECK (("alerts"."type", "alerts"."family") in (('low_stock', 'stock'), ('out_of_stock', 'stock'))),
	CONSTRAINT "alerts_subject_type_check" CHECK ("alerts"."subject_type" in ('item')),
	CONSTRAINT "alerts_details_check" CHECK (jsonb_typeof("alerts"."details") = 'object'),
	CONSTRAINT "alerts_cleared_check" CHECK ("alerts"."cleared_at" is null or "alerts"."cleared_at" >= "alerts"."raised_at")
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "alert_types" text[] DEFAULT array['low_stock', 'out_of_stock']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_dismissals" ADD CONSTRAINT "alert_dismissals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_dismissals" ADD CONSTRAINT "alert_dismissals_alert_fk" FOREIGN KEY ("business_id","alert_id") REFERENCES "public"."alerts"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_dismissals" ADD CONSTRAINT "alert_dismissals_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_unique" ON "alerts" USING btree ("business_id","branch_id","subject_type","subject_id","family") WHERE "alerts"."cleared_at" is null;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_alert_types_check" CHECK ("businesses"."alert_types" <@ array['low_stock', 'out_of_stock']::text[]);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alert_dismissals" AS PERMISSIVE FOR ALL TO public USING ("alert_dismissals"."business_id" = (select app_current_business_id())) WITH CHECK ("alert_dismissals"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "alert_dismissals" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alerts" AS PERMISSIVE FOR ALL TO public USING ("alerts"."business_id" = (select app_current_business_id())) WITH CHECK ("alerts"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "alerts" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);