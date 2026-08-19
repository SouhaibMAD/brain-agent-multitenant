// src/modules/shopify/shopify.controller.ts

import type { Request, Response } from 'express';
import { getTenantDb } from '../../db/tenant-connection-manager.js';
import {
  saveShopifyConnection,
  getActiveShopifyConnection,
  syncAllShopifyProducts,
  fetchShopifyProducts,
  deleteShopifyConnection,
} from './shopify.service.js';
import { registerShopDomainMapping, removeShopDomainMapping } from './shopify.tenant-resolver.js';
import type { ConnectShopifyInput } from './shopify.schemas.js';

// req.params.tenantId est typé string | string[] par Express (patterns
// genre ":tenantId+" peuvent produire un tableau) — tenantMiddleware a
// déjà validé/résolu ce paramètre en amont, donc ce cast est sûr ici,
// mais gardé explicite plutôt qu'un `as string` aveugle.
function getTenantId(req: Request): string {
  const raw = req.params.tenantId;
  if (typeof raw !== 'string') {
    throw new Error('INVALID_TENANT_ID_PARAM');
  }
  return raw;
}

// POST /:tenantId/shopify/connect
// Protégé requireMinimumRole('admin_tenant') — action d'infrastructure
// sensible, même logique que la connexion WhatsApp (BLOC 6.6)
export async function connectShopify(req: Request, res: Response): Promise<void> {
  const tenantId = getTenantId(req);
  const input = req.body as ConnectShopifyInput;

  // Vérification que le token fonctionne réellement avant de le stocker —
  // évite de sauvegarder un token invalide qu'on découvrirait cassé
  // seulement au prochain webhook, plusieurs jours plus tard
  try {
    await fetchShopifyProducts(input.shopDomain, input.accessToken);
  } catch {
    res.status(400).json({ error: 'SHOPIFY_TOKEN_INVALID', message: 'Le token ne permet pas de lire les produits — vérifiez le scope read_products et le domaine.' });
    return;
  }

  const db = await getTenantDb(tenantId);
  const connection = await saveShopifyConnection(db, input);

  // Enregistre le mapping shop_domain → tenantId en control plane, pour
  // que le webhook entrant puisse router vers ce tenant plus tard
  await registerShopDomainMapping(input.shopDomain, tenantId);

  res.status(201).json({ id: connection.id, shopDomain: input.shopDomain });
}

// GET /:tenantId/shopify/status
export async function getShopifyStatus(req: Request, res: Response): Promise<void> {
  const tenantId = getTenantId(req);
  const db = await getTenantDb(tenantId);
  const connection = await getActiveShopifyConnection(db);

  if (!connection) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    shopDomain: connection.shopDomain,
    lastSyncedAt: connection.lastSyncedAt,
  });
}

// POST /:tenantId/shopify/sync
// Sync manuelle complète — utile pour le premier import et pour la démo
// (ne pas dépendre uniquement des webhooks pendant la soutenance)
export async function triggerShopifySync(req: Request, res: Response): Promise<void> {
  const tenantId = getTenantId(req);
  const db = await getTenantDb(tenantId);
  const connection = await getActiveShopifyConnection(db);

  if (!connection) {
    res.status(404).json({ error: 'SHOPIFY_NOT_CONNECTED' });
    return;
  }

  const result = await syncAllShopifyProducts(db, connection.shopDomain, connection.accessToken);
  res.json(result);
}
// DELETE /:tenantId/shopify/connection
export async function disconnectShopify(req: Request, res: Response): Promise<void> {
  const tenantId = getTenantId(req);
  const db = await getTenantDb(tenantId);
  const connection = await getActiveShopifyConnection(db);

  if (!connection) {
    res.status(404).json({ error: 'SHOPIFY_NOT_CONNECTED' });
    return;
  }

  await deleteShopifyConnection(db, connection.shopDomain);
  await removeShopDomainMapping(connection.shopDomain);

  res.status(204).send();
}