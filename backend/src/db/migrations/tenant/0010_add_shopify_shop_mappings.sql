-- Migration 0010 : intégration Shopify (sync catalogue, lecture seule Shopify → Brain Agent)

-- sku devient nullable en DB (contrainte "obligatoire" reste appliquée en code
-- pour les imports CSV/JSON via Zod dans import.service.ts — seules les
-- variantes synchronisées depuis Shopify peuvent avoir sku = NULL)
ALTER TABLE "product_variants" ALTER COLUMN "sku" DROP NOT NULL;

-- Identifiants Shopify sur products / product_variants (nullable : NULL pour
-- tout produit créé via import CSV/JSON classique, rempli uniquement pour
-- les produits synchronisés depuis Shopify)
ALTER TABLE "products" ADD COLUMN "shopify_product_id" varchar(50);
ALTER TABLE "product_variants" ADD COLUMN "shopify_variant_id" varchar(50);

-- UNIQUE sur colonne nullable : Postgres autorise plusieurs NULL sans
-- conflit (comportement standard SQL), donc pas de souci pour les produits
-- non-Shopify qui auront tous shopify_product_id = NULL
CREATE UNIQUE INDEX "products_shopify_product_id_unique" ON "products" ("shopify_product_id");
CREATE UNIQUE INDEX "product_variants_shopify_variant_id_unique" ON "product_variants" ("shopify_variant_id");

-- Credentials Shopify par tenant (table tenant-scoped, cohérent avec le
-- reste du schéma tenant — pas de tenant_id nécessaire, le scoping est
-- déjà assuré par database-per-tenant)
CREATE TABLE "shopify_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_domain" varchar(255) NOT NULL,
  "access_token" text NOT NULL,
  "scopes" varchar(500),
  "is_active" boolean NOT NULL DEFAULT true,
  "last_synced_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "shopify_connections_shop_domain_unique" ON "shopify_connections" ("shop_domain");