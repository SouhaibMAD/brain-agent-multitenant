ALTER TABLE "products" ADD COLUMN "category" varchar(100);--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");