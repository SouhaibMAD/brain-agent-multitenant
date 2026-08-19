// src/modules/shopify/shopify.tenant-resolver.ts

// PROBLÈME RÉSOLU ICI : shopify_connections vit en tenant plane (comme
// whatsapp_sessions), mais le webhook Shopify arrive SANS tenantId dans
// l'URL — juste un shop_domain dans un header. Il faut donc un moyen de
// résoudre shop_domain → tenantId AVANT de pouvoir ouvrir la bonne
// connexion tenant. Solution : une table de mapping légère en control
// plane, remplie au moment de saveShopifyConnection() (voir
// shopify.controller.ts), cohérent avec le pattern déjà utilisé pour
// whatsapp_signal_keys/tenantId (BLOC 5 — "tenantId porté directement
// dans le payload pour résoudre l'œuf-et-poule").

import { eq } from 'drizzle-orm';
import { db as controlDb } from '../../db/control/index.js';
import { shopifyShopMappings } from '../../db/control/schema.js';
import { getTenantDb } from '../../db/tenant-connection-manager.js';
import type { getTenantDb as GetTenantDbType } from '../../db/tenant-connection-manager.js';

export async function registerShopDomainMapping(shopDomain: string, tenantId: string): Promise<void> {
  const existing = await controlDb
    .select({ id: shopifyShopMappings.id })
    .from(shopifyShopMappings)
    .where(eq(shopifyShopMappings.shopDomain, shopDomain))
    .limit(1);

  if (existing[0]) {
    await controlDb
      .update(shopifyShopMappings)
      .set({ tenantId })
      .where(eq(shopifyShopMappings.id, existing[0].id));
    return;
  }

  await controlDb.insert(shopifyShopMappings).values({ shopDomain, tenantId });
}

export async function removeShopDomainMapping(shopDomain: string): Promise<void> {
  await controlDb.delete(shopifyShopMappings).where(eq(shopifyShopMappings.shopDomain, shopDomain));
}

export async function getTenantDbByShopDomain(
  shopDomain: string
): Promise<Awaited<ReturnType<typeof GetTenantDbType>> | null> {
  const mapping = await controlDb
    .select({ tenantId: shopifyShopMappings.tenantId })
    .from(shopifyShopMappings)
    .where(eq(shopifyShopMappings.shopDomain, shopDomain))
    .limit(1);

  if (!mapping[0]) return null;

  return getTenantDb(mapping[0].tenantId);
}