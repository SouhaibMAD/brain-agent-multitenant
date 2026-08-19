// backend/src/modules/conversations/conversations.schemas.ts
import { z } from "zod";

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const tenantIdConversationIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
  conversationId: z.string().uuid("conversationId invalide"),
});

const CONVERSATION_STATUSES = ["bot_active", "lead", "handover"] as const;

export const listConversationsQuerySchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
});

export const sendManualMessageSchema = z.object({
  content: z.string().trim().min(1, "content requis").max(4000, "content trop long"),
});

export const toggleBotSchema = z.object({
  enabled: z.boolean(),
});

export const appendNoteSchema = z.object({
  content: z.string().trim().min(1, "content requis").max(2000, "content trop long"),
});