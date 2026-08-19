// src/modules/products/import.service.ts

import { eq, inArray } from 'drizzle-orm';
import { products, productVariants } from '../../db/tenant/schema.js';
import type { getTenantDb } from '../../db/tenant-connection-manager.js';
import type {
  ImportRow,
  ParsedImportRow,
  ImportRowError,
  ImportResult,
  ImportMode,
} from './products.types.js';
import { generateEmbedding } from '../catalog/embedding.service.js';

// Type réel de l'instance db tenant, tiré directement du gestionnaire de connexions
type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;


// ─── Phase 1 : parsing & validation syntaxique ─────────

function parseAttributes(raw?: string): Record<string, string> {
  if (!raw || raw.trim() === '') return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(';')) {
    const [key, value] = pair.split(':').map((s) => s.trim());
    if (key && value) result[key] = value;
  }
  return result;
}

function parseTags(raw?: string): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function parseAndValidateRows(rows: ImportRow[]): {
  parsed: ParsedImportRow[];
  errors: ImportRowError[];
} {
  const parsed: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const productRef = row.product_ref?.trim();
    const productName = row.product_name?.trim();
    const sku = row.sku?.trim();

    if (!productRef) {
      errors.push({ rowNumber, sku, reason: 'product_ref manquant' });
      return;
    }
    if (!productName) {
      errors.push({ rowNumber, productRef, sku, reason: 'product_name manquant' });
      return;
    }
    if (!sku) {
      errors.push({ rowNumber, productRef, reason: 'sku manquant' });
      return;
    }

    const price = Number(row.price);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ rowNumber, productRef, sku, reason: `price invalide: "${row.price}"` });
      return;
    }

    const stock = Number(row.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      errors.push({ rowNumber, productRef, sku, reason: `stock invalide: "${row.stock}"` });
      return;
    }

    parsed.push({
      productRef,
      productName,
      productDescription: row.product_description?.trim() || undefined,
      category: row.category?.trim() || undefined, // nouveau
      sku,
      price,
      stock,
      attributes: parseAttributes(row.attributes),
      imageUrl: row.image_url?.trim() || undefined,
      tags: parseTags(row.tags),
      rowNumber,
    });
  });

  return { parsed, errors };
}

// ─── Phase 2 : groupement explicite par product_ref ────

interface ProductGroup {
  productRef: string;
  productName: string;
  productDescription?: string | undefined;
  category?: string | undefined; // nouveau
  imageUrl?: string | undefined;
  tags: string[];
  variantRows: ParsedImportRow[];
}

function groupRowsByProductRef(parsed: ParsedImportRow[]): Map<string, ProductGroup> {
  const groups = new Map<string, ProductGroup>();

  for (const row of parsed) {
    const existing = groups.get(row.productRef);
    if (existing) {
      existing.variantRows.push(row);
      continue;
    }
    // première ligne du groupe = source des champs produit
    groups.set(row.productRef, {
      productRef: row.productRef,
      productName: row.productName,
      productDescription: row.productDescription,
      category: row.category, // nouveau
      imageUrl: row.imageUrl,
      tags: row.tags,
      variantRows: [row],
    });
  }

  return groups;
}

// ─── Phase 3 : chargement de l'état existant (2 requêtes) ─

async function loadExistingState(
  db: TenantDb,
  groups: Map<string, ProductGroup>
): Promise<{
  existingVariantsBySku: Map<string, { id: string; productId: string }>;
  existingProductsByRef: Map<string, { id: string; name: string }>;
}> {
  const allSkus = Array.from(groups.values()).flatMap((g) =>
    g.variantRows.map((r) => r.sku)
  );
  const allRefs = Array.from(groups.keys());

  const existingVariantsBySku = new Map<string, { id: string; productId: string }>();
  const existingProductsByRef = new Map<string, { id: string; name: string }>(); // ← corrigé ici (name ajouté)

  if (allSkus.length > 0) {
    const rows = await db
      .select({ id: productVariants.id, productId: productVariants.productId, sku: productVariants.sku })
      .from(productVariants)
      .where(inArray(productVariants.sku, allSkus));
    for (const r of rows) {
      existingVariantsBySku.set(r.sku, { id: r.id, productId: r.productId });
    }
  }

  if (allRefs.length > 0) {
    const rows = await db
      .select({ id: products.id, productRef: products.productRef, name: products.name })
      .from(products)
      .where(inArray(products.productRef, allRefs));
    for (const r of rows) {
      if (r.productRef) existingProductsByRef.set(r.productRef, { id: r.id, name: r.name });
    }
  }

  return { existingVariantsBySku, existingProductsByRef };
}

// ─── Phase 4 : résolution des décisions, par groupe ────

type RowDecision =
  | { type: 'create_product_and_variants'; group: ProductGroup }
  | { type: 'create_variant_on_existing_product'; row: ParsedImportRow; productId: string; productName: string }
  | { type: 'update_variant'; row: ParsedImportRow; variantId: string; productName: string }
  | { type: 'reject'; row: ParsedImportRow; reason: string };

function resolveDecisions(
  groups: Map<string, ProductGroup>,
  existingVariantsBySku: Map<string, { id: string; productId: string }>,
  existingProductsByRef: Map<string, { id: string; name: string }> 
): RowDecision[] {
  const decisions: RowDecision[] = [];

  for (const group of groups.values()) {
    const existingProduct = existingProductsByRef.get(group.productRef);

    if (existingProduct) {
      // produit déjà connu → traiter chaque variante individuellement
      for (const row of group.variantRows) {
        const existingVariant = existingVariantsBySku.get(row.sku);

        if (!existingVariant) {
          decisions.push({
            type: 'create_variant_on_existing_product',
            row,
            productId: existingProduct.id,
            productName: existingProduct.name, // nouveau
          });
        } else if (existingVariant.productId === existingProduct.id) {
          decisions.push({ type: 'update_variant', row, variantId: existingVariant.id, productName: existingProduct.name });
        }else {
          decisions.push({
            type: 'reject',
            row,
            reason: `sku "${row.sku}" appartient déjà à un autre produit`,
          });
        }
      }
    } else {
      // product_ref nouveau → une seule création de produit pour tout le groupe
      // sauf si une ligne réutilise un sku déjà existant ailleurs (rejet ciblé)
      const rejectedRows = new Set<string>();
      for (const row of group.variantRows) {
        const existingVariant = existingVariantsBySku.get(row.sku);
        if (existingVariant) {
          decisions.push({
            type: 'reject',
            row,
            reason: `sku "${row.sku}" existe déjà et n'appartient pas à ce product_ref`,
          });
          rejectedRows.add(row.sku);
        }
      }

      const remainingRows = group.variantRows.filter((r) => !rejectedRows.has(r.sku));
      if (remainingRows.length > 0) {
        decisions.push({
          type: 'create_product_and_variants',
          group: { ...group, variantRows: remainingRows },
        });
      }
    }
  }

  return decisions;
}

// ─── Phase 5 : exécution (sautée en dry-run) ───────────

// Fonction utilitaire pour construire le texte à embedder, à ajouter avant executeDecisions :
function buildEmbeddingText(productName: string, sku: string, attributes: Record<string, string>): string {
  const attributesText = Object.values(attributes).join(' ');
  return `${productName} ${sku} ${attributesText}`.trim();
}

async function executeDecisions(
  db: TenantDb,
  decisions: RowDecision[],
  mode: ImportMode
): Promise<ImportResult> {
  const errors: ImportRowError[] = [];
  let created = 0;
  let updated = 0;
  let rejected = 0;

  for (const decision of decisions) {
    if (decision.type === 'reject') {
      rejected += 1;
      errors.push({
        rowNumber: decision.row.rowNumber,
        productRef: decision.row.productRef,
        sku: decision.row.sku,
        reason: decision.reason,
      });
    }
  }

  if (mode === 'dry-run') {
    for (const decision of decisions) {
      if (decision.type === 'create_product_and_variants') {
        created += decision.group.variantRows.length;
      } else if (decision.type === 'create_variant_on_existing_product') {
        created += 1;
      } else if (decision.type === 'update_variant') {
        updated += 1;
      }
    }
    return { mode, totalRows: 0, created, updated, rejected, errors };
  }

  // mode réel (replace ou merge) : exécution en transaction
  await db.transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.delete(productVariants);
      await tx.delete(products);
    }

    for (const decision of decisions) {
      if (decision.type === 'create_product_and_variants') {
        const [insertedProduct] = await tx
          .insert(products)
          .values({
            productRef: decision.group.productRef,
            name: decision.group.productName,
            description: decision.group.productDescription,
            category: decision.group.category, // nouveau
            imageUrl: decision.group.imageUrl,
            tags: decision.group.tags,
          })
          .returning({ id: products.id });

        for (const row of decision.group.variantRows) {
          const embedding = await generateEmbedding(
            buildEmbeddingText(decision.group.productName, row.sku, row.attributes)
          );
          await tx.insert(productVariants).values({
            productId: insertedProduct!.id,
            sku: row.sku,
            attributes: row.attributes,
            price: row.price.toString(),
            stock: row.stock,
            productNameSnapshot: decision.group.productName, // nouveau
            embedding, // nouveau
          });
          created += 1;
        }
      } else if (decision.type === 'create_variant_on_existing_product') {
        const embedding = await generateEmbedding(
          buildEmbeddingText(decision.productName, decision.row.sku, decision.row.attributes)
        );
        await tx.insert(productVariants).values({
          productId: decision.productId,
          sku: decision.row.sku,
          attributes: decision.row.attributes,
          price: decision.row.price.toString(),
          stock: decision.row.stock,
          productNameSnapshot: decision.productName, // nouveau    
          embedding, // nouveau    
        });
        created += 1;
      } else if (decision.type === 'update_variant') {
        const embedding = await generateEmbedding(
          buildEmbeddingText(decision.productName, decision.row.sku, decision.row.attributes)
        );
        await tx
          .update(productVariants)
          .set({
            attributes: decision.row.attributes,
            price: decision.row.price.toString(),
            stock: decision.row.stock,
            embedding, // nouveau
            updatedAt: new Date(),
          })
          .where(eq(productVariants.id, decision.variantId));
        updated += 1;
      }
    }
  });

  return { mode, totalRows: 0, created, updated, rejected, errors };
}

// ─── Point d'entrée ─────────────────────────────────────

export async function importCatalog(
  db: TenantDb,
  rows: ImportRow[],
  mode: ImportMode
): Promise<ImportResult> {
  const { parsed, errors: parseErrors } = parseAndValidateRows(rows);
  const groups = groupRowsByProductRef(parsed);
  const { existingVariantsBySku, existingProductsByRef } = await loadExistingState(db, groups);
  const decisions = resolveDecisions(groups, existingVariantsBySku, existingProductsByRef);
  const result = await executeDecisions(db, decisions, mode);

  return {
    ...result,
    rejected: result.rejected + parseErrors.length,
    errors: [...parseErrors, ...result.errors],
    totalRows: rows.length,
  };
}