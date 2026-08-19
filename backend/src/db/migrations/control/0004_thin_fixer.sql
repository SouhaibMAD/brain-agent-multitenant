CREATE TABLE "whatsapp_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"creds_json" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_credentials_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_signal_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_type" varchar(50) NOT NULL,
	"key_id" varchar(255) NOT NULL,
	"key_data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_session_keytype_keyid" UNIQUE("session_id","key_type","key_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_credentials" ADD CONSTRAINT "whatsapp_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_signal_keys" ADD CONSTRAINT "whatsapp_signal_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_signal_keys_session_idx" ON "whatsapp_signal_keys" USING btree ("session_id");