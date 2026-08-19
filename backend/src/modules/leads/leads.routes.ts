// backend/src/modules/leads/leads.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { tenantMiddleware } from "../../middleware/tenant.middleware.js";
import { requireMinimumRole } from "../../middleware/requireMinimumRole.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  tenantIdParamSchema,
  tenantIdLeadIdParamSchema,
  listLeadsQuerySchema,
  updateLeadStatusSchema,
} from "./leads.schemas.js";
import { handleListLeads, handleUpdateLeadStatus } from "./leads.controller.js";

const router = Router({ mergeParams: true });

router.get(
  "/:tenantId/leads",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, "params"),
  validate(listLeadsQuerySchema, "query"),
  handleListLeads
);

router.patch(
  "/:tenantId/leads/:leadId",
  authMiddleware,
  tenantMiddleware,
  requireMinimumRole("admin_tenant", "agent"),
  validate(tenantIdLeadIdParamSchema, "params"),
  validate(updateLeadStatusSchema, "body"),
  handleUpdateLeadStatus
);

export default router;