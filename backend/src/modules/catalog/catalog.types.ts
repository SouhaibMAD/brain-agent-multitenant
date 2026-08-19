/**
 * src/modules/catalog/catalog.types.ts
 *
 * Types purs du module catalog — aucune logique, aucun accès DB.
 */

/** Une variante telle que renvoyée dans les résultats de recherche. */
export interface CatalogVariantResult {
  sku: string;
  attributes: Record<string, string>;
  price: string; // numeric Postgres → string côté JS (précision monétaire préservée)
  stock: number;
}

/** Un produit + ses variantes, format compact destiné à être lu par un LLM. */
export interface CatalogProductResult {
  productRef: string | null;
  name: string;
  description: string | null;
  category: string | null; // nouveau
  variants: CatalogVariantResult[];
}

/** Résultat complet renvoyé par l'endpoint de recherche catalogue. */
export interface CatalogSearchResult {
  query: string;
  resultCount: number;
  products: CatalogProductResult[];
}

/** Paramètres d'entrée de searchCatalog, alignés sur le tool schema Groq. */
export interface CatalogSearchParams {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
}