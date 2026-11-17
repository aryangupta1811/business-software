-- P1.3 (Module 00 #6–8, #14, #21, #27, #29, #31). The new NOT NULL columns have no default:
-- no business rows exist anywhere yet, and a database that has some fails here loudly.
CREATE TABLE "recovery_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_keys_key_hash_check" CHECK ("recovery_keys"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "recovery_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "recovery_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name" text,
	"email" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('owner', 'staff')),
	CONSTRAINT "users_email_check" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_owner_email_check" CHECK ("users"."role" <> 'owner' or "users"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "state_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "pin_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "drug_licence" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "fssai" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "business_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "phone" text NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "gst_status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "pan" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "features" text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "owner_lock_minutes" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "staff_idle_minutes" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_keys" ADD CONSTRAINT "recovery_keys_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_keys" ADD CONSTRAINT "recovery_keys_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_keys_one_unused_per_user" ON "recovery_keys" USING btree ("business_id","user_id") WHERE "recovery_keys"."used_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_owner_email_unique" ON "users" USING btree ("email") WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_owner_per_business" ON "users" USING btree ("business_id") WHERE "users"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "entry_log" ADD CONSTRAINT "entry_log_actor_fk" FOREIGN KEY ("business_id","actor_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_state_code_check" CHECK ("branches"."state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_pin_code_check" CHECK ("branches"."pin_code" ~ '^[1-9][0-9]{5}$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_gstin_check" CHECK ("branches"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and left("branches"."gstin", 2) = "branches"."state_code");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_fssai_check" CHECK ("branches"."fssai" ~ '^[0-9]{14}$');--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_business_type_check" CHECK ("businesses"."business_type" in ('kirana', 'medical', 'clothing', 'electronics', 'hardware'));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_gst_status_check" CHECK ("businesses"."gst_status" in ('unregistered', 'regular', 'composition'));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_phone_check" CHECK ("businesses"."phone" ~ '^[1-9][0-9]{9}$');--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_pan_check" CHECK ("businesses"."pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_features_check" CHECK ("businesses"."features" <@ array['loose_weight', 'expiry_dates', 'udhaar_prominent', 'batches', 'mrp', 'expiry_alerts', 'variants', 'exchanges', 'barcode_labels', 'serial_numbers', 'warranty', 'service_items', 'multiple_units', 'wholesale_price', 'large_credit']::text[]);--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_lock_minutes_check" CHECK ("businesses"."owner_lock_minutes" between 1 and 30);--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_staff_idle_minutes_check" CHECK ("businesses"."staff_idle_minutes" between 5 and 120);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "recovery_keys" AS PERMISSIVE FOR ALL TO public USING ("recovery_keys"."business_id" = (select app_current_business_id())) WITH CHECK ("recovery_keys"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ("users"."business_id" = (select app_current_business_id())) WITH CHECK ("users"."business_id" = (select app_current_business_id()));