// src/modules/products/products.service.ts

import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { products, productVariants } from '../../db/tenant/schema.js';
import type { getTenantDb } from '../../db/tenant-connection-manager.js';
import type { ListProductsParams, ProductOutput, ProductVariantOutput } from './products.types.js';

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

// Liste tous les produits avec leurs variantes imbriquées.
// Filtrage optionnel par catégorie exacte et/ou recherche texte (nom produit / SKU).
// Volumes V1 (catalogues de quelques milliers de lignes max, voir BLOC 3) —
// pas besoin de pagination serveur ni de recherche full-text ici, c'est un
// éditeur admin, pas le canal de recherche client (déjà couvert par
// catalog.service.ts / searchCatalog pour l'agent).
export async function listProducts(
  db: TenantDb,
  params: ListProductsParams
): Promise<ProductOutput[]> {
  const conditions: SQL[] = [];

  if (params.category) {
    conditions.push(eq(products.category, params.category));
  }

  if (params.search) {
    const term = `%${params.search}%`;
    // recherche sur nom produit OU sku variante — nécessite le leftJoin déjà en place
    conditions.push(or(ilike(products.name, term), ilike(productVariants.sku, term))!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      product: products,
      variant: productVariants,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(whereClause)
    .orderBy(desc(products.updatedAt));

  return groupRowsIntoProducts(rows);
}

// Regroupe les lignes plates (1 ligne = 1 variante, à cause du leftJoin)
// en produits avec un tableau `variants`. Un produit sans variante
// (théoriquement impossible en usage normal, cf. BLOC 3 — "toujours au
// moins une variante" — mais possible après un import partiel/erreur)
// apparaît avec variants: [].
function groupRowsIntoProducts(
  rows: { product: typeof products.$inferSelect; variant: typeof productVariants.$inferSelect | null }[]
): ProductOutput[] {
  const byId = new Map<string, ProductOutput>();

  for (const row of rows) {
    let entry = byId.get(row.product.id);
    if (!entry) {
      entry = {
        id: row.product.id,
        productRef: row.product.productRef,
        name: row.product.name,
        description: row.product.description,
        category: row.product.category,
        imageUrl: row.product.imageUrl,
        images: (row.product.images as string[]) ?? [],
        tags: (row.product.tags as string[]) ?? [],
        createdAt: row.product.createdAt.toISOString(),
        updatedAt: row.product.updatedAt.toISOString(),
        variants: [],
      };
      byId.set(row.product.id, entry);
    }

    if (row.variant) {
      const v: ProductVariantOutput = {
        id: row.variant.id,
        sku: row.variant.sku,
        attributes: (row.variant.attributes as Record<string, string>) ?? {},
        price: row.variant.price,
        stock: row.variant.stock,
        createdAt: row.variant.createdAt.toISOString(),
        updatedAt: row.variant.updatedAt.toISOString(),
      };
      entry.variants.push(v);
    }
  }

  return Array.from(byId.values());
}   