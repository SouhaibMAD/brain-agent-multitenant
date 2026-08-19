// src/modules/shopify/shopify.webhook.controller.ts

import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getTenantDbByShopDomain } from './shopify.tenant-resolver.js';
import {
  upsertShopifyProduct,
  deleteShopifyProduct,
} from './shopify.service.js';
import type { ShopifyProduct } from './shopify.types.js';
import { config } from '../../config/index.js';

/**
 * Vérifie la signature HMAC Shopify sur le raw body.
 * Shopify signe avec le webhook secret (Client Secret de l'app, ou un
 * secret dédié configuré au moment de la création du webhook) — comparaison
 * en temps constant obligatoire pour éviter une attaque par timing.
 */
function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string | undefined): boolean {
  if (!hmacHeader) return false;

  const computedHmac = crypto
    .createHmac('sha256', config.shopifyWebhookSecret)
    .update(rawBody)
    .digest('base64');

  const a = Buffer.from(computedHmac);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * POST /webhooks/shopify/products
 * Route PUBLIQUE (pas de authMiddleware/tenantMiddleware) — Shopify appelle
 * cette URL directement, sans JWT. La seule protection est la vérification
 * HMAC ci-dessus. Le tenant est résolu via le shop_domain présent dans le
 * header X-Shopify-Shop-Domain, pas via l'URL.
 */
export async function handleShopifyProductWebhook(req: Request, res: Response): Promise<void> {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopDomain = req.get('X-Shopify-Shop-Domain');
  const topic = req.get('X-Shopify-Topic');

  // req.body doit être un Buffer brut ici — voir middleware raw body dans app.ts
  const rawBody = req.body as Buffer;

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    // 401 générique volontaire — ne jamais préciser "HMAC invalide" vs
    // "shop inconnu" à un appelant non authentifié, même si ce n'est
    // techniquement pas un attaquant dans 99% des cas ici
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  if (!shopDomain) {
    res.status(400).json({ error: 'MISSING_SHOP_DOMAIN' });
    return;
  }

  // Toujours répondre 200 rapidement une fois l'HMAC validé — même
  // philosophie que whatsapp-inbound (BLOC 4/5) : Shopify retente les
  // webhooks en échec, un traitement lent ou une erreur métier ne doit
  // jamais provoquer un retry inutile sur un événement déjà reçu.
  res.status(200).json({ received: true });

  try {
    const db = await getTenantDbByShopDomain(shopDomain);
    if (!db) {
      console.error(`[shopify webhook] tenant introuvable pour shop_domain=${shopDomain}`);
      return;
    }

    const payload = JSON.parse(rawBody.toString('utf-8')) as ShopifyProduct;

    if (topic === 'products/delete') {
      await deleteShopifyProduct(db, String(payload.id));
    } else {
      // products/create et products/update partagent le même traitement
      await upsertShopifyProduct(db, payload);
    }
  } catch (err) {
    // erreur après le 200 déjà envoyé — log uniquement, cohérent avec la
    // résilience déjà en place sur l'agent (BLOC 4) : ne jamais faire
    // planter le process sur un événement externe individuel
    console.error('[shopify webhook] erreur de traitement', err);
  }
}