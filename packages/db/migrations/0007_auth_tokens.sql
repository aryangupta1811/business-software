-- P1.4 email links (Module 00 #30, #32; design docs/plans/2026-11-19-p1.4-login-design.md,
-- section 6): one-time tokens for email confirmation and password reset, stored as hashes.
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_kind_check" CHECK ("auth_tokens"."kind" in ('confirm_email', 'reset_password')),
	CONSTRAINT "auth_tokens_token_hash_check" CHECK ("auth_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_tokens_expiry_check" CHECK ("auth_tokens"."expires_at" > "auth_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-written: owners skip RLS unless it is forced, and app_owner owns every table.
ALTER TABLE "auth_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_fk" FOREIGN KEY ("business_id","user_id") REFERENCES "public"."users"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_one_open_per_user" ON "auth_tokens" USING btree ("business_id","user_id","kind") WHERE "auth_tokens"."used_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "auth_tokens" AS PERMISSIVE FOR ALL TO public USING ("auth_tokens"."business_id" = (select app_current_business_id())) WITH CHECK ("auth_tokens"."business_id" = (select app_current_business_id()));