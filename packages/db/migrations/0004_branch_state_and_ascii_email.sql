-- P1.3 review fixes. A branch can't stand in state 97 (Other Territory, a place of supply
-- outside any state), and an email is printable ASCII only, so one mailbox has one spelling
-- and a look-alike letter or a zero-width space can't make it a second owner (Module 00 #27).
-- Adding a CHECK checks the rows already there: a database holding such a row fails here.
ALTER TABLE "branches" DROP CONSTRAINT "branches_state_code_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_check";--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_state_code_check" CHECK ("branches"."state_code" ~ '^[0-9]{2}$' and "branches"."state_code" <> '97');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_check" CHECK ("users"."email" = lower(btrim("users"."email")) and "users"."email" ~ '^[!-~]+$');