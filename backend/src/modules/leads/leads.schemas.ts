// backend/src/modules/leads/leads.schemas.ts
import { z } from "zod";
import { LEAD_STATUSES } from "./leads.types.js";

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const tenantIdLeadIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
  leadId: z.string().uuid("leadId invalide"),
});

// Corrigé pour matcher le CDC §3.10 (6 statuts, voir leads.types.ts) —
// l'ancienne liste (nouveau/qualifie/transfere_humain) ne reflétait que
// les 3 valeurs réellement écrites par le code, pas les 6 valides selon le CDC.
export const listLeadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
});

export const updateLeadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES as [string, ...string[]]),
});