// backend/src/modules/whatsapp/whatsapp.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { tenantMiddleware } from "../../middleware/tenant.middleware.js";
import { requireMinimumRole } from "../../middleware/requireMinimumRole.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  tenantIdParamSchema,
  tenantIdSessionIdParamSchema,
} from "./whatsapp.schemas.js";
import {
  handleCreateWhatsappSession,
  handleGetWhatsappSessionQr,
  handleListWhatsappSessions,
  handleGetWhatsappSessionStatus,
  handleDisconnectWhatsappSession,
  handleReconnectWhatsappSession
} from "./whatsapp.controller.js";

const router = Router({ mergeParams: true });

router.post(
  "/:tenantId/whatsapp/sessions",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant"),
  validate(tenantIdParamSchema, "params"),
  handleCreateWhatsappSession
);
router.get(
  "/:tenantId/whatsapp/sessions",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, "params"),
  handleListWhatsappSessions
);
router.get(
  "/:tenantId/whatsapp/sessions/:sessionId/qr",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdSessionIdParamSchema, "params"),
  handleGetWhatsappSessionQr
);
router.post(
  "/:tenantId/whatsapp/sessions/:sessionId/disconnect",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant"),
  validate(tenantIdSessionIdParamSchema, "params"),
  handleDisconnectWhatsappSession
);
router.get(
  "/:tenantId/whatsapp/sessions/:sessionId",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdSessionIdParamSchema, "params"),
  handleGetWhatsappSessionStatus
);

router.post(
  "/:tenantId/whatsapp/sessions/:sessionId/reconnect",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant"),
  validate(tenantIdSessionIdParamSchema, "params"),
  handleReconnectWhatsappSession
);

export default router;