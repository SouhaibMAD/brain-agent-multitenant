// backend/src/modules/tenants/tenants.schemas.ts
import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // slug utilisé directement dans l'URL frontend (/:tenantSlug/...) — doit
  // rester strictement URL-safe, pas de majuscule/espace/caractère spécial
  // qui casserait le routing React Router.
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Le slug ne doit contenir que des lettres minuscules, chiffres et tirets"),
});

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});