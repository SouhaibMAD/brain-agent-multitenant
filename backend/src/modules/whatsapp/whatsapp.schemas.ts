// backend/src/modules/whatsapp/whatsapp.schemas.ts
import { z } from "zod";

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const tenantIdSessionIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
  sessionId: z.string().uuid("sessionId invalide"),
});