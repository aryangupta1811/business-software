CREATE TABLE "item_stock" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"average_cost" bigint,
	"last_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_stock_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "item_stock_item_branch_unique" UNIQUE("business_id","branch_id","item_id"),
	CONSTRAINT "item_stock_average_cost_check" CHECK ("item_stock"."average_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "item_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_stock" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_cost" bigint,
	"value" bigint,
	"balance_after" bigint NOT NULL,
	"business_date" date NOT NULL,
	"reason" text,
	"note" text,
	"actor_id" uuid NOT NULL,
	"request_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "stock_movements_request_key_unique" UNIQUE("business_id","request_key"),
	CONSTRAINT "stock_movements_kind_check" CHECK ("stock_movements"."kind" in ('opening', 'adjustment')),
	CONSTRAINT "stock_movements_quantity_check" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_unit_cost_check" CHECK ("stock_movements"."unit_cost" >= 0),
	CONSTRAINT "stock_movements_reason_check" CHECK (("stock_movements"."kind" = 'adjustment') = ("stock_movements"."reason" is not null) and "stock_movements"."reason" in ('damaged', 'expired', 'theft', 'own_use', 'count_mismatch', 'other')),
	CONSTRAINT "stock_movements_note_check" CHECK (char_length("stock_movements"."note") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "negative_stock" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_stock" ADD CONSTRAINT "item_stock_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_fk" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_fk" FOREIGN KEY ("business_id","actor_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("business_id","branch_id","item_id","id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_negative_stock_check" CHECK ("businesses"."negative_stock" in ('warn', 'block'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "item_stock" AS PERMISSIVE FOR ALL TO public USING ("item_stock"."business_id" = (select app_current_business_id())) WITH CHECK ("item_stock"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "item_stock" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO public USING ("stock_movements"."business_id" = (select app_current_business_id())) WITH CHECK ("stock_movements"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "stock_movements" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
-- Hand-written (ADR 0007 rules 2 and 4): the ledger is append-only. app_runtime keeps INSERT
-- and SELECT from the default privileges (0000); DELETE was never granted.
REVOKE UPDATE ON "stock_movements" FROM app_runtime;
