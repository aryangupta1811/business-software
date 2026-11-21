ALTER TABLE "users" ADD COLUMN "home_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions_added" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions_removed" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discount_limit_basis_points" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_branch_fk" FOREIGN KEY ("business_id","home_branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_username_check" CHECK ("users"."role" <> 'staff' or "users"."password_hash" is null or "users"."username" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_staff_home_branch_check" CHECK ("users"."role" <> 'staff' or "users"."home_branch_id" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_permissions_overlap_check" CHECK (not ("users"."permissions_added" && "users"."permissions_removed"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_discount_limit_check" CHECK ("users"."discount_limit_basis_points" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_permissions_check" CHECK ("users"."role" <> 'owner' or (cardinality("users"."permissions_added") = 0 and cardinality("users"."permissions_removed") = 0 and "users"."discount_limit_basis_points" is null));