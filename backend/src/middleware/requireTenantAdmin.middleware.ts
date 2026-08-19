// C:\Users\DELL Tac\Desktop\brain-agent-multitenant\backend\src\middleware\requireTenantAdmin.middleware.ts
import type { Request, Response, NextFunction } from "express";

export function requireTenantAdmin(req: Request, res: Response, next: NextFunction): void {
  // Suppose que tenantMiddleware a déjà tourné avant lui — c'est lui qui résout
  // req.tenantRole depuis user_tenant_roles. Sans ça req.tenantRole est undefined.
  if (req.tenantRole !== "admin_tenant") {
    res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" });
    return;
  }

  next();
}