// C:\Users\DELL Tac\Desktop\brain-agent-multitenant\backend\src\middleware\tenant.middleware.ts:
import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/control/index.js";
import { userTenantRoles, tenants, users } from "../db/control/schema.js";

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { tenantId } = req.params;

  if (typeof tenantId !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
    return;
    }


  if (!req.user) {
    // ce middleware suppose que authMiddleware a déjà tourné avant lui
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant || !tenant.isActive) {
    res.status(403).json({ error: "TENANT_INACTIVE" });
    return;
  }

  const link = await db.query.userTenantRoles.findFirst({
    where: and(
      eq(userTenantRoles.userId, req.user.userId),
      eq(userTenantRoles.tenantId, tenantId)
    ),
  });

  if (link) {
    req.tenantRole = link.role;
    next();
    return;
  }

  // Pas de rôle explicite sur ce tenant — dernier recours : super_admin plateforme.
  // isSuperAdmin est indépendant de user_tenant_roles par design (ARCHITECTURE.md
  // BLOC 1) : un super_admin gère potentiellement des tenants sur lesquels il n'a
  // jamais été explicitement assigné. req.tenantRole reste undefined dans ce cas —
  // les routes qui en dépendent doivent vérifier req.user.isSuperAdmin séparément
  // si elles ont besoin de distinguer les deux cas (voir requireSuperAdminOrTenantAdmin).
  const user = await db.query.users.findFirst({
    where: eq(users.id, req.user.userId),
    columns: { isSuperAdmin: true },
  });

  if (user?.isSuperAdmin) {
    next();
    return;
  }

  res.status(403).json({ error: "TENANT_ACCESS_DENIED" });
}