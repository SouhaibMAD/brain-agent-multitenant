// src/modules/products/import.controller.ts

import type { Request, Response } from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { importCatalog } from './import.service.js';
import type { ImportRow, ImportMode } from './products.types.js';
import { getTenantDb } from '../../db/tenant-connection-manager.js';

const upload = multer({ storage: multer.memoryStorage() });
export const importUploadMiddleware = upload.single('file');

function detectFormat(file: Express.Multer.File): 'csv' | 'json' | null {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.csv')) return 'csv';

  if (file.mimetype === 'application/json') return 'json';
  if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') return 'csv';

  return null;
}

function parseFileToRows(file: Express.Multer.File, format: 'csv' | 'json'): ImportRow[] {
  const content = file.buffer.toString('utf-8');

  if (format === 'json') {
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      throw new Error('INVALID_JSON_FORMAT');
    }
    return data as ImportRow[];
  }

  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ImportRow[];
}

function parseMode(query: unknown): ImportMode {
  const raw = typeof query === 'string' ? query : 'dry-run';
  if (raw === 'dry-run' || raw === 'replace' || raw === 'merge') return raw;
  return 'dry-run';
}

export async function handleImportCatalog(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'FILE_REQUIRED' });
      return;
    }

    const format = detectFormat(file);
    if (!format) {
      res.status(400).json({ error: 'UNSUPPORTED_FILE_FORMAT' });
      return;
    }

    let rows: ImportRow[];
    try {
      rows = parseFileToRows(file, format);
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_JSON_FORMAT') {
        res.status(400).json({ error: 'INVALID_JSON_FORMAT' });
        return;
      }
      res.status(400).json({ error: 'FILE_PARSING_FAILED' });
      return;
    }

    const mode = parseMode(req.query.mode);

    const { tenantId } = req.params;
    if (typeof tenantId !== 'string') {
      res.status(400).json({ error: 'INVALID_OR_MISSING_TENANT_ID' });
      return;
    }

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

    const result = await importCatalog(db, rows, mode);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[import.controller] Échec import catalogue:', message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

const CSV_TEMPLATE = `product_ref,product_name,product_description,category,sku,price,stock,attributes,image_url,tags
PROD-001,T-shirt col rond,T-shirt en coton bio,vetements,TSHIRT-M-BLEU,120.00,15,taille:M;couleur:bleu,https://example.com/tshirt-bleu.jpg,"vetements,promo"
PROD-001,T-shirt col rond,T-shirt en coton bio,vetements,TSHIRT-L-BLEU,120.00,8,taille:L;couleur:bleu,https://example.com/tshirt-bleu.jpg,"vetements,promo"
`;

export function handleDownloadTemplate(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="catalogue_template.csv"');
  res.status(200).send(CSV_TEMPLATE);
}