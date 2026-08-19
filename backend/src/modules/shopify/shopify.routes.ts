// src/modules/shopify/shopify.routes.ts

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireMinimumRole } from '../../middleware/requireMinimumRole.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { connectShopifySchema } from './shopify.schemas.js';
import {
  connectShopify,
  getShopifyStatus,
  triggerShopifySync,
  disconnectShopify,
} from './shopify.controller.js';

// ─── Routes tenant-scoped (protégées, montées sous /api/tenants) ───
export const shopifyRoutes = Router({ mergeParams: true });

shopifyRoutes.post(
  '/:tenantId/shopify/connect',
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole('admin_tenant'),
  validate(connectShopifySchema),
  connectShopify
);

shopifyRoutes.get(
  '/:tenantId/shopify/status',
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole('admin_tenant', 'agent', 'viewer'),
  getShopifyStatus
);

shopifyRoutes.post(
  '/:tenantId/shopify/sync',
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole('admin_tenant'),
  triggerShopifySync
);

shopifyRoutes.delete(
  '/:tenantId/shopify/connection',
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole('admin_tenant'),
  disconnectShopify
);

// ─── Route webhook publique (montée séparément dans app.ts, PAS sous
// /api/tenants — pas de tenantId dans l'URL, pas de authMiddleware) ───
// Voir shopify.webhook.routes.ts