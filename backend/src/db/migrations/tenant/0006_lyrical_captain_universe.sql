ALTER TABLE "whatsapp_sessions" ALTER COLUMN "phone_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "connection_status" SET DEFAULT 'pending_qr';--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "last_connected_at" timestamp;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD COLUMN "last_disconnect_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" DROP COLUMN "session_data";