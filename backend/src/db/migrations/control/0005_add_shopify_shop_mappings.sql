CREATE TABLE "shopify_shop_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_domain" varchar(255) NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "shopify_shop_mappings_shop_domain_unique" ON "shopify_shop_mappings" ("shop_domain");
 