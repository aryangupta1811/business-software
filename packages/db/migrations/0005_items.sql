-- P1.7 Items (Module 01 #1-3, #8, #16; design docs/plans/2026-11-19-p1.7-items-design.md).
-- Hand-written: the item_name collation (ADR 0019) and FORCE ROW LEVEL SECURITY (ADR 0027).
-- ICU's root order with numbers compared by value: Latin before Devanagari, "Atta 2 kg"
-- before "Atta 10 kg". Queries name it with COLLATE; deterministic, so equality is unchanged.
CREATE COLLATION "item_name" (provider = icu, locale = 'und-u-kn-true');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "categories_name_check" CHECK (char_length("categories"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "item_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"item_id" uuid NOT NULL,
	"item_unit_id" uuid,
	"code" text NOT NULL,
	"in_store" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_barcodes_code_check" CHECK ("item_barcodes"."code" ~ '^[!-~]{4,48}$')
);
--> statement-breakpoint
ALTER TABLE "item_barcodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "item_barcodes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "item_branch_levels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"low_stock_level" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_branch_levels_item_branch_unique" UNIQUE("business_id","item_id","branch_id"),
	CONSTRAINT "item_branch_levels_level_check" CHECK ("item_branch_levels"."low_stock_level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "item_branch_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "item_branch_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "item_units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_code" text,
	"unit_id" uuid,
	"size" bigint NOT NULL,
	"selling_price" bigint,
	"mrp" bigint,
	"sold_as_pack" boolean NOT NULL,
	"bought_as_pack" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_units_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "item_units_business_id_item_id_id_unique" UNIQUE("business_id","item_id","id"),
	CONSTRAINT "item_units_one_unit_check" CHECK (num_nonnulls("item_units"."unit_code", "item_units"."unit_id") = 1),
	CONSTRAINT "item_units_unit_code_check" CHECK ("item_units"."unit_code" in ('kg', 'g', 'litre', 'ml', 'piece', 'box', 'dozen', 'pack', 'bag', 'metre', 'foot', 'pair')),
	CONSTRAINT "item_units_numbers_check" CHECK ("item_units"."size" > 0 and "item_units"."selling_price" >= 0 and "item_units"."mrp" > 0),
	CONSTRAINT "item_units_mrp_check" CHECK ("item_units"."mrp" is null or "item_units"."selling_price" is null or "item_units"."selling_price" <= "item_units"."mrp")
);
--> statement-breakpoint
ALTER TABLE "item_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "item_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"hindi_name" text,
	"code" text,
	"category_id" uuid,
	"brand" text,
	"stock_unit" text NOT NULL,
	"selling_price" bigint NOT NULL,
	"wholesale_price" bigint,
	"purchase_price" bigint,
	"mrp" bigint,
	"price_includes_tax" boolean DEFAULT true NOT NULL,
	"gst_rate" integer,
	"hsn" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "items_kind_check" CHECK ("items"."kind" in ('goods', 'service')),
	CONSTRAINT "items_name_check" CHECK (char_length("items"."name") between 1 and 100),
	CONSTRAINT "items_code_check" CHECK ("items"."code" ~ '^[!-~]{1,20}$'),
	CONSTRAINT "items_stock_unit_check" CHECK ("items"."stock_unit" in ('kg', 'g', 'litre', 'ml', 'piece', 'box', 'dozen', 'pack', 'bag', 'metre', 'foot', 'pair')),
	CONSTRAINT "items_prices_check" CHECK ("items"."selling_price" >= 0 and "items"."wholesale_price" >= 0 and "items"."purchase_price" >= 0 and "items"."mrp" > 0),
	CONSTRAINT "items_mrp_check" CHECK ("items"."mrp" is null or ("items"."price_includes_tax" and "items"."selling_price" <= "items"."mrp" and coalesce("items"."wholesale_price", 0) <= "items"."mrp")),
	CONSTRAINT "items_service_check" CHECK ("items"."kind" = 'goods' or "items"."mrp" is null),
	CONSTRAINT "items_gst_rate_check" CHECK ("items"."gst_rate" in (0, 25, 300, 500, 1800, 4000)),
	CONSTRAINT "items_hsn_check" CHECK (case "items"."kind" when 'goods' then "items"."hsn" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' else "items"."hsn" ~ '^99[0-9]{4}$' end),
	CONSTRAINT "items_version_check" CHECK ("items"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"name" text NOT NULL,
	"hindi_name" text,
	"base_unit" text NOT NULL,
	"default_size" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "units_name_check" CHECK (char_length("units"."name") between 1 and 30),
	CONSTRAINT "units_not_built_in_check" CHECK (lower("units"."name") not in ('kg', 'g', 'litre', 'ml', 'piece', 'box', 'dozen', 'pack', 'bag', 'metre', 'foot', 'pair')),
	CONSTRAINT "units_base_unit_check" CHECK ("units"."base_unit" in ('kg', 'g', 'litre', 'ml', 'piece', 'box', 'dozen', 'pack', 'bag', 'metre', 'foot', 'pair')),
	CONSTRAINT "units_default_size_check" CHECK ("units"."default_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_pack_fk" FOREIGN KEY ("business_id","item_id","item_unit_id") REFERENCES "public"."item_units"("business_id","item_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_branch_levels" ADD CONSTRAINT "item_branch_levels_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_branch_levels" ADD CONSTRAINT "item_branch_levels_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_branch_levels" ADD CONSTRAINT "item_branch_levels_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_unit_fk" FOREIGN KEY ("business_id","unit_id") REFERENCES "public"."units"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_fk" FOREIGN KEY ("business_id","category_id") REFERENCES "public"."categories"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_live_name_unique" ON "categories" USING btree ("business_id",lower("name")) WHERE "categories"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "item_barcodes_live_code_unique" ON "item_barcodes" USING btree ("business_id","code") WHERE "item_barcodes"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "item_units_live_unit_unique" ON "item_units" USING btree ("business_id","item_id",coalesce("unit_code", "unit_id"::text)) WHERE "item_units"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_live_name_unique" ON "items" USING btree ("business_id",lower("name")) WHERE "items"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_live_code_unique" ON "items" USING btree ("business_id",lower("code")) WHERE "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "items_updated_at_idx" ON "items" USING btree ("business_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "units_live_name_unique" ON "units" USING btree ("business_id",lower("name")) WHERE "units"."archived_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO public USING ("categories"."business_id" = (select app_current_business_id())) WITH CHECK ("categories"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "item_barcodes" AS PERMISSIVE FOR ALL TO public USING ("item_barcodes"."business_id" = (select app_current_business_id())) WITH CHECK ("item_barcodes"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "item_branch_levels" AS PERMISSIVE FOR ALL TO public USING ("item_branch_levels"."business_id" = (select app_current_business_id())) WITH CHECK ("item_branch_levels"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "item_units" AS PERMISSIVE FOR ALL TO public USING ("item_units"."business_id" = (select app_current_business_id())) WITH CHECK ("item_units"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items" AS PERMISSIVE FOR ALL TO public USING ("items"."business_id" = (select app_current_business_id())) WITH CHECK ("items"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "units" AS PERMISSIVE FOR ALL TO public USING ("units"."business_id" = (select app_current_business_id())) WITH CHECK ("units"."business_id" = (select app_current_business_id()));