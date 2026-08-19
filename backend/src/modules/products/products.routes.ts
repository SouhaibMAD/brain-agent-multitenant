// backend/src/modules/products/products.routes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { requireMinimumRole } from '../../middleware/requireMinimumRole.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  tenantIdParamSchema,
  listProductsQuerySchema,
  importModeQuerySchema,
} from './products.schemas.js';
import {
  importUploadMiddleware,
  handleImportCatalog,
  handleDownloadTemplate,
} from './import.controller.js';
import { handleListProducts } from './products.controller.js';

const router = Router({ mergeParams: true });

router.get(
  '/:tenantId/products',
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, 'params'),
  validate(listProductsQuerySchema, 'query'),
  handleListProducts
);

router.get(
  '/:tenantId/products/import/template',
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, 'params'),
  handleDownloadTemplate
);

router.post(
  '/:tenantId/products/import',
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole('admin_tenant', 'agent'),
  validate(tenantIdParamSchema, 'params'),
  validate(importModeQuerySchema, 'query'),
  importUploadMiddleware,
  handleImportCatalog
);

export default router;