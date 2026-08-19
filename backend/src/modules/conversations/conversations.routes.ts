// backend/src/modules/conversations/conversations.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { tenantMiddleware } from "../../middleware/tenant.middleware.js";
import { requireMinimumRole } from "../../middleware/requireMinimumRole.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  tenantIdParamSchema,
  tenantIdConversationIdParamSchema,
  listConversationsQuerySchema,
  sendManualMessageSchema,
  toggleBotSchema,
  appendNoteSchema,
} from "./conversations.schemas.js";
import {
  handleSendManualMessage,
  handleToggleBot,
  handleResumeConversation,
  handleListConversations,
  handleGetConversationMessages,
  handleAppendNote,
} from "./conversations.controller.js";

const router = Router({ mergeParams: true });

router.get(
  "/:tenantId/conversations",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, "params"),
  validate(listConversationsQuerySchema, "query"),
  handleListConversations
);

router.get(
  "/:tenantId/conversations/:conversationId/messages",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdConversationIdParamSchema, "params"),
  handleGetConversationMessages
);

router.patch(
  "/:tenantId/conversations/:conversationId/notes",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant", "agent"),
  validate(tenantIdConversationIdParamSchema, "params"),
  validate(appendNoteSchema, "body"),
  handleAppendNote
);

router.post(
  "/:tenantId/conversations/:conversationId/messages",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant", "agent"),
  validate(tenantIdConversationIdParamSchema, "params"),
  validate(sendManualMessageSchema, "body"),
  handleSendManualMessage
);

router.patch(
  "/:tenantId/conversations/:conversationId/bot",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant", "agent"),
  validate(tenantIdConversationIdParamSchema, "params"),
  validate(toggleBotSchema, "body"),
  handleToggleBot
);

router.post(
  "/:tenantId/conversations/:conversationId/resume",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant", "agent"),
  validate(tenantIdConversationIdParamSchema, "params"),
  handleResumeConversation
);

export default router;