-- Ajout de la colonne dénormalisée (snapshot du nom produit au moment de l'insert/update variante)
ALTER TABLE "product_variants" ADD COLUMN "product_name_snapshot" varchar(255);

-- Colonne générée : combine sku + product_name_snapshot (to_tsvector classique)
-- + valeurs textuelles de attributes (jsonb_to_tsvector, natif, pas de sous-requête)
ALTER TABLE "product_variants" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(product_name_snapshot, '') || ' ' || coalesce(sku, ''))
    || jsonb_to_tsvector('simple', coalesce(attributes, '{}'::jsonb), '"string"')
  ) STORED;

CREATE INDEX "product_variants_search_vector_gin_idx" ON "product_variants" USING gin ("search_vector");