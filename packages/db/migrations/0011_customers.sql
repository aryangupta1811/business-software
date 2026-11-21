CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"gstin" text,
	"legal_name" text,
	"address" text,
	"pin_code" text,
	"state_code" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "customers_name_check" CHECK (char_length("customers"."name") between 1 and 100),
	CONSTRAINT "customers_phone_check" CHECK ("customers"."phone" ~ '^[1-9][0-9]{9}$'),
	CONSTRAINT "customers_gstin_check" CHECK ("customers"."gstin" is null or ("customers"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and "customers"."state_code" is not distinct from left("customers"."gstin", 2) and "customers"."legal_name" is not null and "customers"."address" is not null)),
	CONSTRAINT "customers_legal_name_check" CHECK (char_length("customers"."legal_name") between 1 and 100),
	CONSTRAINT "customers_address_check" CHECK (char_length("customers"."address") between 1 and 200),
	CONSTRAINT "customers_pin_code_check" CHECK ("customers"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "customers_state_code_check" CHECK ("customers"."state_code" in ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '97')),
	CONSTRAINT "customers_version_check" CHECK ("customers"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_live_phone_unique" ON "customers" USING btree ("business_id","phone") WHERE "customers"."phone" is not null and "customers"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_live_gstin_unique" ON "customers" USING btree ("business_id","gstin") WHERE "customers"."gstin" is not null and "customers"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING ("customers"."business_id" = (select app_current_business_id())) WITH CHECK ("customers"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "customers" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);