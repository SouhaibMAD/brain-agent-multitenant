// src/modules/shopify/shopify.schemas.ts

import { z } from 'zod';

// Body attendu pour POST /:tenantId/shopify/connect
export const connectShopifySchema = z.object({
  shopDomain: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9-]+\.myshopify\.com$/,
      'shopDomain doit être au format "nom-du-store.myshopify.com"'
    ),
  accessToken: z
    .string()
    .trim()
    .regex(/^shpat_[a-zA-Z0-9]+$/, 'accessToken doit commencer par "shpat_"'),
});

export type ConnectShopifyInput = z.infer<typeof connectShopifySchema>;

// Note : le body du webhook Shopify n'est volontairement PAS validé via
// Zod à ce stade — il doit être lu comme Buffer brut (raw body) pour le
// calcul HMAC dans le middleware, avant tout parsing JSON. La validation
// de structure (ShopifyProduct) se fait après coup dans shopify.service.ts
// via un simple cast typé, cohérent avec la confiance qu'on accorde à une
// requête déjà authentifiée par la signature HMAC.