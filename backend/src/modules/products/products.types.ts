// src/modules/products/products.types.ts

// ─── Ligne brute du fichier CSV/JSON importé ───────────
export interface ImportRow {
  product_ref: string;
  product_name: string;
  product_description?: string;
  category?: string; // nouveau — champ descriptif produit, lu uniquement 1ère ligne du groupe
  sku: string;
  price: string; // string brute avant parsing (vient du CSV)
  stock: string;
  attributes?: string; // format "cle:valeur;cle:valeur"
  image_url?: string;
  tags?: string; // format "tag1,tag2"
}

// ─── Ligne validée/parsée, prête à insertion ───────────
export interface ParsedImportRow {
  productRef: string;
  productName: string;
  productDescription?: string | undefined;
  category?: string | undefined; // nouveau
  sku: string;
  price: number;
  stock: number;
  attributes: Record<string, string>;
  imageUrl?: string | undefined;
  tags: string[];
  rowNumber: number;
}

// ─── Mode d'import ──────────────────────────────────────
export type ImportMode = 'dry-run' | 'replace' | 'merge';

// ─── Erreur de validation sur une ligne précise ────────
export interface ImportRowError {
  rowNumber: number;
  productRef?: string;
  sku?: string;
  reason: string;
}

// ─── Résultat global d'un import (dry-run ou réel) ─────
export interface ImportResult {
  mode: ImportMode;
  totalRows: number;
  created: number;
  updated: number;
  rejected: number;
  errors: ImportRowError[];
}

// ─── Input création manuelle produit (hors import) ─────
export interface CreateProductInput {
  productRef?: string;
  name: string;
  description?: string;
  category?: string; // nouveau
  imageUrl?: string;
  images?: string[];
  tags?: string[];
}

export interface CreateVariantInput {
  productId: string;
  sku: string;
  attributes?: Record<string, string>;
  price: number;
  stock: number;
}

// ─── Lecture catalogue (GET /:tenantId/products) ────────
export interface ProductVariantOutput {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  price: string;
  stock: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductOutput {
  id: string;
  productRef: string | null;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  images: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  variants: ProductVariantOutput[];
}

export interface ListProductsParams {
  category?: string | undefined; 
  search?: string | undefined; 
}