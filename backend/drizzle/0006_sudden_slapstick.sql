ALTER TABLE "app_attest_keys" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "app_attest_keys" ADD COLUMN "assertion_counter" integer DEFAULT 0 NOT NULL;