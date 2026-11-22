-- A dismissal remembers the type the alert had (07 #19). Dismissals made before this took the
-- default, low stock, so at worst an out-of-stock alert shows again once. The default is
-- dropped at once: every new dismissal names its type. (A plain UPDATE can't backfill here:
-- the table forces row-level security and the migration role has no business set.)
ALTER TABLE "alert_dismissals" ADD COLUMN "dismissed_type" text DEFAULT 'low_stock' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_dismissals" ALTER COLUMN "dismissed_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "alert_dismissals" ADD CONSTRAINT "alert_dismissals_type_check" CHECK ("alert_dismissals"."dismissed_type" in ('low_stock', 'out_of_stock'));
