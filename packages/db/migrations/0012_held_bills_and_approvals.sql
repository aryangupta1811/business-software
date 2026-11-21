CREATE TABLE "held_bills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"bill_key" uuid NOT NULL,
	"label" text,
	"draft" jsonb NOT NULL,
	"total_paise" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"held_by" uuid NOT NULL,
	"closed_by" uuid,
	"resumed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_bills_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "held_bills_label_check" CHECK (char_length("held_bills"."label") between 1 and 40),
	CONSTRAINT "held_bills_numbers_check" CHECK ("held_bills"."total_paise" >= 0 and "held_bills"."line_count" >= 1),
	CONSTRAINT "held_bills_closed_check" CHECK (num_nonnulls("held_bills"."resumed_at", "held_bills"."discarded_at") <= 1 and ("held_bills"."closed_by" is null) = (num_nonnulls("held_bills"."resumed_at", "held_bills"."discarded_at") = 0))
);
--> statement-breakpoint
ALTER TABLE "held_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "held_bills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"branch_id" uuid NOT NULL,
	"bill_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"line_basis_points" integer NOT NULL,
	"bill_basis_points" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_approvals_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "owner_approvals_kind_check" CHECK ("owner_approvals"."kind" in ('discount')),
	CONSTRAINT "owner_approvals_shares_check" CHECK ("owner_approvals"."line_basis_points" between 0 and 10000 and "owner_approvals"."bill_basis_points" between 0 and 10000),
	CONSTRAINT "owner_approvals_expiry_check" CHECK ("owner_approvals"."expires_at" > "owner_approvals"."created_at")
);
--> statement-breakpoint
ALTER TABLE "owner_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_held_by_fk" FOREIGN KEY ("business_id","held_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_closed_by_fk" FOREIGN KEY ("business_id","closed_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_requested_by_fk" FOREIGN KEY ("business_id","requested_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_approved_by_fk" FOREIGN KEY ("business_id","approved_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "held_bills_open_bill_key_unique" ON "held_bills" USING btree ("business_id","bill_key") WHERE "held_bills"."resumed_at" is null and "held_bills"."discarded_at" is null;--> statement-breakpoint
CREATE INDEX "held_bills_open_idx" ON "held_bills" USING btree ("business_id","branch_id","id") WHERE "held_bills"."resumed_at" is null and "held_bills"."discarded_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "held_bills" AS PERMISSIVE FOR ALL TO public USING ("held_bills"."business_id" = (select app_current_business_id())) WITH CHECK ("held_bills"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "held_bills" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "owner_approvals" AS PERMISSIVE FOR ALL TO public USING ("owner_approvals"."business_id" = (select app_current_business_id())) WITH CHECK ("owner_approvals"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "owner_approvals" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);