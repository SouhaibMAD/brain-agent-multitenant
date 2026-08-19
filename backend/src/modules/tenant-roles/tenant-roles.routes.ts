// backend/src/modules/tenant-roles/tenant-roles.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { tenantMiddleware } from "../../middleware/tenant.middleware.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.middleware.js";
import { requireTenantAdmin } from "../../middleware/requireTenantAdmin.middleware.js";
import { requireSuperAdminOrTenantAdmin } from "../../middleware/requireSuperAdminOrTenantAdmin.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  assignUserRoleSchema,
  updateUserRoleSchema,
  inviteUserSchema,
  lookupEmailQuerySchema,
  tenantIdParamSchema,
  tenantIdUserIdParamSchema,
} from "./tenant-roles.schemas.js";
import {
  assignUserRoleHandler,
  listUserRolesHandler,
  listMyTenantsHandler,
  inviteUserToTenantController,
  lookupUserByEmailHandler,
  updateUserRoleHandler,
  removeUserRoleHandler
} from "./tenant-roles.controller.js";

const router = Router({ mergeParams: true });

router.get("/my", authMiddleware, listMyTenantsHandler);

router.get(
  "/users/lookup",
  authMiddleware,
  requireSuperAdmin,
  validate(lookupEmailQuerySchema, "query"),
  lookupUserByEmailHandler
);

router.post(
  "/:tenantId/roles",
  authMiddleware,
  requireSuperAdmin,
  validate(tenantIdParamSchema, "params"),
  validate(assignUserRoleSchema, "body"),
  assignUserRoleHandler
);

router.get(
  "/:tenantId/roles",
  authMiddleware,
  tenantMiddleware,
  requireSuperAdminOrTenantAdmin,
  validate(tenantIdParamSchema, "params"),
  listUserRolesHandler
);

router.post(
  "/:tenantId/invite",
  authMiddleware,
  tenantMiddleware,
  requireTenantAdmin,
  validate(tenantIdParamSchema, "params"),
  validate(inviteUserSchema, "body"),
  inviteUserToTenantController
);

router.patch(
  "/:tenantId/roles/:userId",
  authMiddleware,
  requireSuperAdmin,
  validate(tenantIdUserIdParamSchema, "params"),
  validate(updateUserRoleSchema, "body"),
  updateUserRoleHandler
);

router.delete(
  "/:tenantId/roles/:userId",
  authMiddleware,
  requireSuperAdmin,
  validate(tenantIdUserIdParamSchema, "params"),
  removeUserRoleHandler
);

export default router;