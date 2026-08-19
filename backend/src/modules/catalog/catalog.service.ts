// src/modules/catalog/catalog.service.ts

import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-serverless";
import type * as tenantSchema from "../../db/tenant/schema.js";
import type { CatalogProductResult, CatalogSearchResult, CatalogSearchParams } from "./catalog.types.js";
import { generateEmbedding } from "./embedding.service.js";

type TenantDb = ReturnType<typeof drizzle<typeof tenantSchema>>;

const MAX_RESULTS = 4;
const VECTOR_SIMILARITY_THRESHOLD = 0.75; // distance cosinus ; à recalibrer empiriquement selon le catalogue réel

/**
 * src/modules/catalog/catalog.service.ts
 *
 * Recherche catalogue hybride pour l'agent IA : full-text (products +
 * product_variants) + recherche vectorielle (embeddings locaux,
 * multilingual-e5-small) en complément, combinés par UNION et dédupliqués
 * par MAX(rank).
 *
 * Filtres category/min_price/max_price appliqués UNE SEULE FOIS, après le
 * matching texte/vectoriel (jamais dupliqués dans les branches UNION) :
 *   - WHERE sur le SELECT final : décide si le produit apparaît (au moins
 *     une variante doit respecter la fourchette de prix demandée).
 *   - LEFT JOIN conditionnel sur product_variants : décide quelles
 *     variantes sont affichées dans le json_agg (jamais une variante hors
 *     fourchette montrée à l'agent — cohérent avec le garde-fou
 *     anti-hallucination : l'agent ne doit jamais halluciner un prix hors
 *     du contexte demandé par le client).
 *   - category filtre le produit entier (WHERE), pas les variantes
 *     individuellement, category vivant sur products, pas product_variants.
 *
 * Chaque paramètre nullable est casté explicitement (::text, ::numeric)
 * dans le template sql``. Sans ce cast, Postgres échoue à la préparation
 * de la requête avec "could not determine data type of parameter" dès
 * que le paramètre est NULL des deux côtés d'un OR sans contexte de type
 * — cause identifiée et confirmée par test isolé (script jetable,
 * src/scripts/test-category-filter.ts) le 7 août 2026. Ne jamais retirer
 * ces casts.
 *
 * Garde-fou anti-hallucination : les produits en rupture totale de stock
 * restent inclus dans les résultats, jamais filtrés.
 *
 * Tri : pertinence (rank, incluant score vectoriel) → disponibilité (stock)
 * → id (tie-breaker déterministe). Limite : 4 produits maximum.
 */
export async function searchCatalog(
  tenantDb: TenantDb,
  params: CatalogSearchParams
): Promise<CatalogSearchResult> {
  const trimmedQuery = params.query.trim();

  if (trimmedQuery.length === 0) {
    return { query: params.query, resultCount: 0, products: [] };
  }

  const category = params.category ?? null;
  const minPrice = params.minPrice ?? null;
  const maxPrice = params.maxPrice ?? null;

  // Embedding de la requête client, calculé à la volée à chaque recherche.
  const queryEmbedding = await generateEmbedding(trimmedQuery);
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  const result = await tenantDb.execute(sql`
    WITH matched_products AS (
      SELECT
        p.id,
        ts_rank(p.search_vector, websearch_to_tsquery('simple', ${trimmedQuery})) AS rank
      FROM products p
      WHERE p.search_vector @@ websearch_to_tsquery('simple', ${trimmedQuery})

      UNION

      SELECT
        p.id,
        ts_rank(pv.search_vector, websearch_to_tsquery('simple', ${trimmedQuery})) AS rank
      FROM products p
      INNER JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.search_vector @@ websearch_to_tsquery('simple', ${trimmedQuery})

      UNION

      SELECT
        p.id,
        0::real AS rank
      FROM products p
      INNER JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.sku ILIKE '%' || ${trimmedQuery} || '%'

      UNION

      SELECT
        p.id,
        (1 - (pv.embedding <=> ${embeddingLiteral}::vector))::real AS rank
      FROM products p
      INNER JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.embedding IS NOT NULL
        AND (pv.embedding <=> ${embeddingLiteral}::vector) < ${VECTOR_SIMILARITY_THRESHOLD}
    ),
    deduplicated AS (
      SELECT id, MAX(rank) AS rank
      FROM matched_products
      GROUP BY id
    ),
    ranked AS (
      SELECT
        d.id,
        d.rank,
        EXISTS (
          SELECT 1 FROM product_variants pv
          WHERE pv.product_id = d.id AND pv.stock > 0
        ) AS has_stock
      FROM deduplicated d
    )
    SELECT
      p.id,
      p.product_ref AS "productRef",
      p.name,
      p.description,
      p.category,
      COALESCE(
        json_agg(
          json_build_object(
            'sku', pv.sku,
            'attributes', pv.attributes,
            'price', pv.price,
            'stock', pv.stock
          )
          ORDER BY pv.sku
        ) FILTER (
          WHERE pv.id IS NOT NULL
            AND (${minPrice}::numeric IS NULL OR pv.price >= ${minPrice}::numeric)
            AND (${maxPrice}::numeric IS NULL OR pv.price <= ${maxPrice}::numeric)
        ),
        '[]'
      ) AS variants
    FROM ranked r
    INNER JOIN products p ON p.id = r.id
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    WHERE (${category}::text IS NULL OR p.category = ${category}::text)
      AND EXISTS (
        SELECT 1 FROM product_variants pv2
        WHERE pv2.product_id = p.id
          AND (${minPrice}::numeric IS NULL OR pv2.price >= ${minPrice}::numeric)
          AND (${maxPrice}::numeric IS NULL OR pv2.price <= ${maxPrice}::numeric)
      )
    GROUP BY p.id, p.product_ref, p.name, p.description, p.category, r.rank, r.has_stock
    ORDER BY r.rank DESC, r.has_stock DESC, p.id ASC
    LIMIT ${MAX_RESULTS};
  `);

  const rows = result.rows as Array<{
    id: string;
    productRef: string | null;
    name: string;
    description: string | null;
    category: string | null;
    variants: unknown;
  }>;

  const products: CatalogProductResult[] = rows.map((row) => ({
    productRef: row.productRef,
    name: row.name,
    description: row.description,
    category: row.category,
    variants:
      typeof row.variants === "string" ? JSON.parse(row.variants) : (row.variants as CatalogProductResult["variants"]),
  }));

  return {
    query: trimmedQuery,
    resultCount: products.length,
    products,
  };
}