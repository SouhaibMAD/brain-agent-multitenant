-- Colonne générée par Postgres (STORED) — jamais écrite par l'application.
-- Pondération : A = name (poids max), B = tags, C = description.
-- Dictionnaire "simple" : pas de stemming linguistique, pour rester safe
-- sur du contenu mixte français / darija / arabe translittéré.
--
-- Note technique : la première tentative utilisait une sous-requête
-- corrélée (jsonb_array_elements_text + string_agg) pour aplatir le
-- jsonb "tags" en texte. Postgres l'a rejetée car une expression
-- GENERATED ALWAYS AS doit être immutable et ne peut pas contenir de
-- sous-requête sur un ensemble de lignes. Cette version caste le jsonb
-- en texte brut puis nettoie les crochets/guillemets/virgules par
-- regex — moins élégant, mais garanti immutable (aucun appel de
-- fonction sur un set, uniquement des opérations texte).
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(
      regexp_replace("tags"::text, '[\[\]",]', ' ', 'g'),
      ''
    )), 'B') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'C')
  ) STORED;--> statement-breakpoint
CREATE INDEX "product_variants_sku_search_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_search_vector_gin_idx" ON "products" USING gin ("search_vector");