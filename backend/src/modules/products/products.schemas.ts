// backend/src/modules/products/products.schemas.ts
import { z } from "zod";

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const listProductsQuerySchema = z.object({
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
});

// mode rejeté explicitement s'il est invalide — plus de fallback silencieux
// vers "dry-run" sur une faute de frappe (?mode=repalce faisait un dry-run
// sans avertir l'utilisateur qu'il pensait faire un vrai replace).
export const importModeQuerySchema = z.object({
  mode: z.enum(["dry-run", "replace", "merge"]).default("dry-run"),
});