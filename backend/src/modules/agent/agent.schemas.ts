// backend/src/modules/agent/agent.schemas.ts
import { z } from "zod";

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const agentMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  channel: z.string().trim().min(1).max(50),
  content: z.string().trim().min(1, "content requis").max(4000, "content trop long"),
  customerIdentifier: z.string().trim().max(200).optional(),
});