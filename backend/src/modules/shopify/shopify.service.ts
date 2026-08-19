// src/modules/shopify/shopify.service.ts

import { eq } from 'drizzle-orm';
import { products, productVariants, shopifyConnections } from '../../db/tenant/schema.js';
import type { getTenantDb } from '../../db/tenant-connection-manager.js';
import { generateEmbedding } from '../catalog/embedding.service.js';
import type {
  ShopifyProduct,
  ShopifyProductsListResponse,
  ShopifyConnectionInput,
  ShopifySyncResult,
} from './shopify.types.js';

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

const SHOPIFY_API_VERSION = '2026-07';

// ─── Connexion : stockage credentials ───────────────────

export async function saveShopifyConnection(
  db: TenantDb,
  input: ShopifyConnectionInput
): Promise<{ id: string }> {
  // upsert simple par shopDomain — une connexion active par store
  const existing = await db
    .select({ id: shopifyConnections.id })
    .from(shopifyConnections)
    .where(eq(shopifyConnections.shopDomain, input.shopDomain))
    .limit(1);

  if (existing[0]) {
    await db
      .update(shopifyConnections)
      .set({
        accessToken: input.accessToken,
        scopes: input.scopes,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(shopifyConnections.id, existing[0].id));
    return { id: existing[0].id };
  }

  const [inserted] = await db
    .insert(shopifyConnections)
    .values({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      scopes: input.scopes,
    })
    .returning({ id: shopifyConnections.id });

  if (!inserted) throw new Error('SHOPIFY_CONNECTION_INSERT_FAILED');
  return { id: inserted.id };
}

export async function deleteShopifyConnection(db: TenantDb, shopDomain: string): Promise<void> {
  // Suppression complète plutôt qu'un simple isActive: false — cohérent
  // avec le nettoyage des sessions pending_qr orphelines (BLOC 7.3) :
  // une reconnexion ultérieure recrée tout proprement, pas besoin de
  // garder une ligne morte pour un historique qui n'a pas de valeur ici
  // (contrairement à whatsapp_sessions, où l'historique de connexion a
  // un intérêt réel affiché en table).
  await db.delete(shopifyConnections).where(eq(shopifyConnections.shopDomain, shopDomain));
}

export async function getActiveShopifyConnection(db: TenantDb) {
  const rows = await db
    .select()
    .from(shopifyConnections)
    .where(eq(shopifyConnections.isActive, true))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Appel Admin API : test de connexion + sync manuelle initiale ───

export async function fetchShopifyProducts(
  shopDomain: string,
  accessToken: string
): Promise<ShopifyProduct[]> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SHOPIFY_API_ERROR_${response.status}`);
  }

  const data = (await response.json()) as ShopifyProductsListResponse;
  return data.products;
}

// ─── Mapping + upsert partagé (utilisé par sync manuelle ET webhook) ───

function buildEmbeddingText(
  productName: string,
  sku: string | null,
  attributes: Record<string, string>
): string {
  const attributesText = Object.values(attributes).join(' ');
  const skuPart = sku ?? '';
  return `${productName} ${skuPart} ${attributesText}`.trim();
}

function mapShopifyTagsToArray(tags: string): string[] {
  if (!tags || tags.trim() === '') return [];
  return tags.split(',').map((t) => t.trim()).filter(Boolean);
}

function variantOptionsToAttributes(variant: ShopifyProduct['variants'][number]): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (variant.option1) attributes.option1 = variant.option1;
  if (variant.option2) attributes.option2 = variant.option2;
  if (variant.option3) attributes.option3 = variant.option3;
  return attributes;
}

/**
 * Upsert d'un produit Shopify + toutes ses variantes, matché par
 * shopifyProductId/shopifyVariantId (pas par sku/product_ref comme
 * import.service.ts — les deux chemins ne partagent pas la même clé de
 * matching, donc pas de réutilisation directe de resolveDecisions ici).
 *
 * Transaction unique par produit — cohérent avec la philosophie déjà
 * actée (import.service.ts) de ne jamais laisser un état partiel en cas
 * d'erreur au milieu de l'écriture.
 */
export async function upsertShopifyProduct(
  db: TenantDb,
  shopifyProduct: ShopifyProduct
): Promise<'created' | 'updated'> {
  const shopifyProductId = String(shopifyProduct.id);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.shopifyProductId, shopifyProductId))
      .limit(1);

    let productId: string;
    let outcome: 'created' | 'updated';

    const productValues = {
      name: shopifyProduct.title,
      description: shopifyProduct.body_html ?? undefined,
      category: shopifyProduct.product_type ?? undefined,
      imageUrl: shopifyProduct.image?.src ?? undefined,
      tags: mapShopifyTagsToArray(shopifyProduct.tags),
    };

    if (existing[0]) {
      productId = existing[0].id;
      outcome = 'updated';
      await tx
        .update(products)
        .set({ ...productValues, updatedAt: new Date() })
        .where(eq(products.id, productId));
    } else {
      const [inserted] = await tx
        .insert(products)
        .values({ ...productValues, shopifyProductId })
        .returning({ id: products.id });
      if (!inserted) throw new Error('SHOPIFY_PRODUCT_INSERT_FAILED');
      productId = inserted.id;
      outcome = 'created';
    }

    for (const variant of shopifyProduct.variants) {
      const shopifyVariantId = String(variant.id);
      const attributes = variantOptionsToAttributes(variant);
      const embedding = await generateEmbedding(
        buildEmbeddingText(shopifyProduct.title, variant.sku, attributes)
      );

      const existingVariant = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.shopifyVariantId, shopifyVariantId))
        .limit(1);

      const variantValues = {
        sku: variant.sku ?? undefined, // undefined → Drizzle "ne pas modifier" en update ; null resterait null en insert par défaut colonne nullable
        attributes,
        price: variant.price,
        stock: variant.inventory_quantity ?? 0,
        productNameSnapshot: shopifyProduct.title,
        embedding,
      };

      if (existingVariant[0]) {
        await tx
          .update(productVariants)
          .set({ ...variantValues, updatedAt: new Date() })
          .where(eq(productVariants.id, existingVariant[0].id));
      } else {
        await tx.insert(productVariants).values({
          productId,
          shopifyVariantId,
          sku: variant.sku, // insert direct : null explicite accepté (colonne nullable)
          attributes,
          price: variant.price,
          stock: variant.inventory_quantity ?? 0,
          productNameSnapshot: shopifyProduct.title,
          embedding,
        });
      }
    }

    return outcome;
  });
}

export async function deleteShopifyProduct(db: TenantDb, shopifyProductId: string): Promise<void> {
  // onDelete: 'cascade' sur product_variants.productId → suppression en cascade automatique
  await db.delete(products).where(eq(products.shopifyProductId, shopifyProductId));
}

// ─── Sync manuelle complète (bouton "Sync now" côté frontend) ───

export async function syncAllShopifyProducts(
  db: TenantDb,
  shopDomain: string,
  accessToken: string
): Promise<ShopifySyncResult> {
  const shopifyProducts = await fetchShopifyProducts(shopDomain, accessToken);

  let created = 0;
  let updated = 0;
  const errors: ShopifySyncResult['errors'] = [];

  for (const product of shopifyProducts) {
    try {
      const outcome = await upsertShopifyProduct(db, product);
      if (outcome === 'created') created += 1;
      else updated += 1;
    } catch (err) {
      errors.push({
        shopifyProductId: String(product.id),
        reason: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
      });
    }
  }

  await db
    .update(shopifyConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(shopifyConnections.shopDomain, shopDomain));

  return {
    totalProducts: shopifyProducts.length,
    created,
    updated,
    skipped: errors.length,
    errors,
  };
}