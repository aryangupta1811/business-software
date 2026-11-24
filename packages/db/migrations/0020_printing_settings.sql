ALTER TABLE "businesses" ADD COLUMN "bill_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "bill_footer_note" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "receipt_size" smallint DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "auto_print" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_bill_language_check" CHECK ("businesses"."bill_language" in ('en', 'hi', 'hi-Latn'));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_bill_footer_note_check" CHECK (char_length("businesses"."bill_footer_note") between 1 and 200);--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_receipt_size_check" CHECK ("devices"."receipt_size" in (80, 58));