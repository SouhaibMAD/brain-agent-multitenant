ALTER TABLE "tenants" ALTER COLUMN "database_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "neon_project_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "provisioning_status" text DEFAULT 'pending' NOT NULL;