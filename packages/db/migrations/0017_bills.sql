CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"pack_id" uuid,
	"item_name" text NOT NULL,
	"item_hindi_name" text,
	"unit" text NOT NULL,
	"hsn" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"price_includes_tax" boolean NOT NULL,
	"quantity_thousandths" bigint NOT NULL,
	"stock_quantity" bigint,
	"unit_price_paise" bigint NOT NULL,
	"discount" jsonb,
	"amount_paise" bigint NOT NULL,
	"item_discount_paise" bigint NOT NULL,
	"gross_paise" bigint NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"bill_discount_paise" bigint NOT NULL,
	"taxable_before_discounts_paise" bigint NOT NULL,
	"discount_off_taxable_paise" bigint NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"unit_cost" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_lines_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "bill_lines_line_unique" UNIQUE("business_id","bill_id","line_no"),
	CONSTRAINT "bill_lines_line_no_check" CHECK ("bill_lines"."line_no" >= 1),
	CONSTRAINT "bill_lines_quantity_check" CHECK ("bill_lines"."quantity_thousandths" > 0),
	CONSTRAINT "bill_lines_stock_quantity_check" CHECK ("bill_lines"."stock_quantity" > 0),
	CONSTRAINT "bill_lines_rate_check" CHECK ("bill_lines"."rate_basis_points" between 0 and 10000),
	CONSTRAINT "bill_lines_total_check" CHECK ("bill_lines"."total_paise" = "bill_lines"."taxable_paise" + "bill_lines"."cgst_paise" + "bill_lines"."sgst_paise" + "bill_lines"."igst_paise")
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"bill_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"tendered_paise" bigint,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_payments_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "bill_payments_mode_check" CHECK ("bill_payments"."mode" in ('cash', 'upi', 'card', 'cheque')),
	CONSTRAINT "bill_payments_amount_check" CHECK ("bill_payments"."amount_paise" > 0),
	CONSTRAINT "bill_payments_tendered_check" CHECK ("bill_payments"."tendered_paise" is null or ("bill_payments"."mode" = 'cash' and "bill_payments"."tendered_paise" >= "bill_payments"."amount_paise")),
	CONSTRAINT "bill_payments_reference_check" CHECK (char_length("bill_payments"."reference") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "bill_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"bill_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"financial_year" text NOT NULL,
	"sequence" integer NOT NULL,
	"number" text NOT NULL,
	"document" text NOT NULL,
	"business_date" date NOT NULL,
	"price_list" text NOT NULL,
	"supplier_state_code" text NOT NULL,
	"place_of_supply_state_code" text NOT NULL,
	"tax" text NOT NULL,
	"customer_id" uuid,
	"buyer" jsonb,
	"seller" jsonb NOT NULL,
	"gross_paise" bigint NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"bill_discount_paise" bigint NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"round_off_paise" bigint NOT NULL,
	"grand_total_paise" bigint NOT NULL,
	"bill_discount" jsonb,
	"approval_id" uuid,
	"held_bill_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "bills_bill_key_unique" UNIQUE("business_id","bill_key"),
	CONSTRAINT "bills_sequence_unique" UNIQUE("business_id","branch_id","financial_year","sequence"),
	CONSTRAINT "bills_number_unique" UNIQUE("business_id","financial_year","number"),
	CONSTRAINT "bills_year_check" CHECK ("bills"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "bills_sequence_check" CHECK ("bills"."sequence" >= 1),
	CONSTRAINT "bills_number_check" CHECK ("bills"."number" ~ '^[A-Z0-9/-]{1,16}$'),
	CONSTRAINT "bills_document_check" CHECK ("bills"."document" in ('tax_invoice', 'bill_of_supply', 'bill')),
	CONSTRAINT "bills_price_list_check" CHECK ("bills"."price_list" in ('retail', 'wholesale')),
	CONSTRAINT "bills_tax_check" CHECK ("bills"."tax" in ('cgst-sgst', 'igst', 'none')),
	CONSTRAINT "bills_states_check" CHECK ("bills"."supplier_state_code" ~ '^[0-9]{2}$' and "bills"."place_of_supply_state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "bills_amounts_check" CHECK ("bills"."gross_paise" >= 0 and "bills"."subtotal_paise" >= 0 and "bills"."bill_discount_paise" >= 0 and "bills"."taxable_paise" >= 0 and "bills"."cgst_paise" >= 0 and "bills"."sgst_paise" >= 0 and "bills"."igst_paise" >= 0),
	CONSTRAINT "bills_total_check" CHECK ("bills"."total_paise" = "bills"."taxable_paise" + "bills"."cgst_paise" + "bills"."sgst_paise" + "bills"."igst_paise"),
	CONSTRAINT "bills_grand_total_check" CHECK ("bills"."round_off_paise" between -49 and 50 and "bills"."grand_total_paise" = "bills"."total_paise" + "bills"."round_off_paise" and "bills"."grand_total_paise" % 100 = 0)
);
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_counters_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "invoice_counters_branch_year_unique" UNIQUE("business_id","branch_id","financial_year"),
	CONSTRAINT "invoice_counters_year_check" CHECK ("invoice_counters"."financial_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "invoice_counters_last_number_check" CHECK ("invoice_counters"."last_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_code_check";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_check";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "invoice_prefix" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_fk" FOREIGN KEY ("business_id","bill_id") REFERENCES "public"."bills"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_fk" FOREIGN KEY ("business_id","bill_id") REFERENCES "public"."bills"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_approval_fk" FOREIGN KEY ("business_id","approval_id") REFERENCES "public"."owner_approvals"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_held_bill_fk" FOREIGN KEY ("business_id","held_bill_id") REFERENCES "public"."held_bills"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_fk" FOREIGN KEY ("business_id","created_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_lines_item_idx" ON "bill_lines" USING btree ("business_id","item_id");--> statement-breakpoint
CREATE INDEX "bill_payments_bill_idx" ON "bill_payments" USING btree ("business_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_approval_unique" ON "bills" USING btree ("business_id","approval_id") WHERE "bills"."approval_id" is not null;--> statement-breakpoint
CREATE INDEX "bills_branch_idx" ON "bills" USING btree ("business_id","branch_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_bill_fk" FOREIGN KEY ("business_id","bill_id") REFERENCES "public"."bills"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_code_check" CHECK ("branches"."code" ~ '^[A-Z0-9]{1,4}$');--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_invoice_prefix_check" CHECK ("businesses"."invoice_prefix" ~ '^[A-Z0-9]{1,4}$');--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_bill_check" CHECK (("stock_movements"."kind" = 'sale') = ("stock_movements"."bill_id" is not null) and ("stock_movements"."kind" <> 'sale' or "stock_movements"."quantity" < 0));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_check" CHECK ("stock_movements"."kind" in ('opening', 'adjustment', 'sale'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bill_lines" AS PERMISSIVE FOR ALL TO public USING ("bill_lines"."business_id" = (select app_current_business_id())) WITH CHECK ("bill_lines"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "bill_lines" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bill_payments" AS PERMISSIVE FOR ALL TO public USING ("bill_payments"."business_id" = (select app_current_business_id())) WITH CHECK ("bill_payments"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "bill_payments" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bills" AS PERMISSIVE FOR ALL TO public USING ("bills"."business_id" = (select app_current_business_id())) WITH CHECK ("bills"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "bills" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_counters" AS PERMISSIVE FOR ALL TO public USING ("invoice_counters"."business_id" = (select app_current_business_id())) WITH CHECK ("invoice_counters"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "invoice_counters" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
-- A saved bill is never edited (02 #14, ADR 0047): append-only, like the entry log and the
-- stock ledger. DELETE was never granted (0000).
REVOKE UPDATE ON "bills" FROM app_runtime;--> statement-breakpoint
REVOKE UPDATE ON "bill_lines" FROM app_runtime;--> statement-breakpoint
REVOKE UPDATE ON "bill_payments" FROM app_runtime;
