// src/modules/products/products.controller.ts

import type { Request, Response } from 'express';
import { getTenantDb } from '../../db/tenant-connection-manager.js';
import { listProducts } from './products.service.js';

export async function handleListProducts(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== 'string') {
      res.status(400).json({ error: 'INVALID_OR_MISSING_TENANT_ID' });
      return;
    }

    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    let db;
    try {
      db = await getTenantDb(tenantId);
    } catch (err) {
      if (err instanceof Error && err.message === 'TENANT_NOT_FOUND') {
        res.status(404).json({ error: 'TENANT_NOT_FOUND' });
        return;
      }
      if (err instanceof Error && err.message === 'TENANT_NOT_PROVISIONED') {
        res.status(409).json({ error: 'TENANT_NOT_PROVISIONED' });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
      return;
    }

    const result = await listProducts(db, { category, search });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}