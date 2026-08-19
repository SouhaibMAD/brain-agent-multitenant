import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { tenantMiddleware } from "../../middleware/tenant.middleware.js";
import { getDashboardStatsHandler } from "./dashboard.controller.js";

const router = Router();

router.get("/:tenantId/dashboard/stats", authMiddleware, tenantMiddleware, getDashboardStatsHandler);

export default router;