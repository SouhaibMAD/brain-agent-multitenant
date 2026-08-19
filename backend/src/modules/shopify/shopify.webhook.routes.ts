// src/modules/shopify/shopify.webhook.routes.ts

import { Router, raw } from 'express';
import { handleShopifyProductWebhook } from './shopify.webhook.controller.js';

// Router séparé, monté directement dans app.ts SANS authMiddleware ni
// tenantMiddleware — Shopify n'a pas de JWT, l'authentification se fait
// exclusivement via la signature HMAC (voir shopify.webhook.controller.ts)

export const shopifyWebhookRoutes = Router();

// express.raw() plutôt qu'express.json() sur CETTE route précise : le
// calcul HMAC nécessite le body brut exact tel qu'envoyé par Shopify,
// avant tout parsing. Si express.json() global tourne déjà dessus, le
// buffer original est perdu et l'HMAC ne peut plus être vérifié.
shopifyWebhookRoutes.post(
  '/webhooks/shopify/products',
  raw({ type: 'application/json' }),
  handleShopifyProductWebhook
);