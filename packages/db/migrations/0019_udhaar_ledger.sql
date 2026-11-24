CREATE TABLE "udhaar_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"customer_id" uuid NOT NULL,
	"balance_paise" bigint DEFAULT 0 NOT NULL,
	"last_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "udhaar_accounts_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "udhaar_accounts_customer_unique" UNIQUE("business_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "udhaar_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "udhaar_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "udhaar_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid DEFAULT app_current_business_id() NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"balance_after_paise" bigint NOT NULL,
	"bill_id" uuid,
	"mode" text,
	"reference" text,
	"reverses_entry_id" uuid,
	"due_date" date,
	"business_date" date NOT NULL,
	"request_key" uuid,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "udhaar_entries_business_id_id_unique" UNIQUE("business_id","id"),
	CONSTRAINT "udhaar_entries_request_key_unique" UNIQUE("business_id","request_key"),
	CONSTRAINT "udhaar_entries_kind_check" CHECK ("udhaar_entries"."kind" in ('opening', 'bill', 'advance_used', 'payment', 'payment_reversal')),
	CONSTRAINT "udhaar_entries_amount_check" CHECK (("udhaar_entries"."kind" in ('bill', 'advance_used', 'payment_reversal') and "udhaar_entries"."amount_paise" > 0)
        or ("udhaar_entries"."kind" = 'payment' and "udhaar_entries"."amount_paise" < 0)
        or ("udhaar_entries"."kind" = 'opening' and "udhaar_entries"."amount_paise" <> 0)),
	CONSTRAINT "udhaar_entries_bill_check" CHECK (("udhaar_entries"."kind" in ('bill', 'advance_used')) = ("udhaar_entries"."bill_id" is not null)),
	CONSTRAINT "udhaar_entries_reverses_check" CHECK (("udhaar_entries"."kind" = 'payment_reversal') = ("udhaar_entries"."reverses_entry_id" is not null)),
	CONSTRAINT "udhaar_entries_mode_check" CHECK (("udhaar_entries"."kind" = 'payment') = ("udhaar_entries"."mode" is not null)
        and ("udhaar_entries"."mode" is null or "udhaar_entries"."mode" in ('cash', 'upi', 'card', 'cheque'))
        and ("udhaar_entries"."mode" is distinct from 'cheque' or "udhaar_entries"."reference" is not null)
        and ("udhaar_entries"."reference" is null or "udhaar_entries"."kind" = 'payment')),
	CONSTRAINT "udhaar_entries_reference_check" CHECK (char_length("udhaar_entries"."reference") between 1 and 40),
	CONSTRAINT "udhaar_entries_due_date_check" CHECK (("udhaar_entries"."amount_paise" > 0) = ("udhaar_entries"."due_date" is not null)),
	CONSTRAINT "udhaar_entries_reason_check" CHECK (("udhaar_entries"."kind" in ('payment_reversal', 'opening')) = ("udhaar_entries"."reason" is not null)
        and char_length("udhaar_entries"."reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "udhaar_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "udhaar_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_payments" DROP CONSTRAINT "bill_payments_mode_check";--> statement-breakpoint
ALTER TABLE "owner_approvals" DROP CONSTRAINT "owner_approvals_kind_check";--> statement-breakpoint
ALTER TABLE "owner_approvals" ALTER COLUMN "line_basis_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_approvals" ALTER COLUMN "bill_basis_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "credit_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "over_credit_limit" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_paise" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "due_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD COLUMN "amount_paise" bigint;--> statement-breakpoint
ALTER TABLE "udhaar_accounts" ADD CONSTRAINT "udhaar_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_accounts" ADD CONSTRAINT "udhaar_accounts_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_accounts" ADD CONSTRAINT "udhaar_accounts_last_entry_fk" FOREIGN KEY ("business_id","last_entry_id") REFERENCES "public"."udhaar_entries"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_customer_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_branch_fk" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_bill_fk" FOREIGN KEY ("business_id","bill_id") REFERENCES "public"."bills"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_reverses_fk" FOREIGN KEY ("business_id","reverses_entry_id") REFERENCES "public"."udhaar_entries"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udhaar_entries" ADD CONSTRAINT "udhaar_entries_created_by_fk" FOREIGN KEY ("business_id","created_by") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "udhaar_entries_customer_idx" ON "udhaar_entries" USING btree ("business_id","customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "udhaar_entries_reverses_unique" ON "udhaar_entries" USING btree ("business_id","reverses_entry_id") WHERE "udhaar_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "udhaar_entries_opening_unique" ON "udhaar_entries" USING btree ("business_id","customer_id") WHERE "udhaar_entries"."kind" = 'opening';--> statement-breakpoint
CREATE UNIQUE INDEX "udhaar_entries_bill_unique" ON "udhaar_entries" USING btree ("business_id","bill_id","kind") WHERE "udhaar_entries"."bill_id" is not null;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_credit_approval_fk" FOREIGN KEY ("business_id","credit_approval_id") REFERENCES "public"."owner_approvals"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bills_credit_approval_unique" ON "bills" USING btree ("business_id","credit_approval_id") WHERE "bills"."credit_approval_id" is not null;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_ledger_check" CHECK ("bill_payments"."reference" is null or "bill_payments"."mode" in ('cash', 'upi', 'card', 'cheque'));--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_mode_check" CHECK ("bill_payments"."mode" in ('cash', 'upi', 'card', 'cheque', 'udhaar', 'advance'));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_over_credit_limit_check" CHECK ("businesses"."over_credit_limit" in ('warn', 'block'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_limit_check" CHECK ("customers"."credit_limit_paise" >= 0);--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_due_days_check" CHECK ("customers"."due_days" between 0 and 365);--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_kind_shape_check" CHECK (("owner_approvals"."kind" = 'discount' and "owner_approvals"."line_basis_points" is not null and "owner_approvals"."bill_basis_points" is not null and "owner_approvals"."amount_paise" is null)
        or ("owner_approvals"."kind" = 'credit_limit' and "owner_approvals"."line_basis_points" is null and "owner_approvals"."bill_basis_points" is null and "owner_approvals"."amount_paise" > 0));--> statement-breakpoint
ALTER TABLE "owner_approvals" ADD CONSTRAINT "owner_approvals_kind_check" CHECK ("owner_approvals"."kind" in ('discount', 'credit_limit'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "udhaar_accounts" AS PERMISSIVE FOR ALL TO public USING ("udhaar_accounts"."business_id" = (select app_current_business_id())) WITH CHECK ("udhaar_accounts"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "udhaar_accounts" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "udhaar_entries" AS PERMISSIVE FOR ALL TO public USING ("udhaar_entries"."business_id" = (select app_current_business_id())) WITH CHECK ("udhaar_entries"."business_id" = (select app_current_business_id()));--> statement-breakpoint
CREATE POLICY "backup_read" ON "udhaar_entries" AS PERMISSIVE FOR SELECT TO "app_backup" USING (true);