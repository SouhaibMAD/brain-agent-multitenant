// backend/src/modules/tenants/tenants.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createTenantSchema, tenantIdParamSchema } from "./tenants.schemas.js";
import {
  createTenantHandler,
  listTenantsHandler,
  deactivateTenantHandler,
} from "./tenants.controller.js";

const router = Router();

router.post("/", authMiddleware, requireSuperAdmin, validate(createTenantSchema), createTenantHandler);
router.get("/", authMiddleware, requireSuperAdmin, listTenantsHandler);
router.patch(
  "/:tenantId/deactivate",
  authMiddleware,
  requireSuperAdmin,
  validate(tenantIdParamSchema, "params"),
  deactivateTenantHandler
);

export default router;