CREATE TABLE "app_attest_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" text NOT NULL,
	"attestation" text NOT NULL,
	"challenge" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	"public_key" text,
	CONSTRAINT "app_attest_keys_key_id_unique" UNIQUE("key_id")
);
