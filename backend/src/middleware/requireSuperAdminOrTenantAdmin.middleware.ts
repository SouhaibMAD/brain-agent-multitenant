import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/control/index.js";
import { users } from "../db/control/schema.js";

// Garde combinée : autorise soit un super_admin plateforme (accès à n'importe quel
// tenant, cohérent avec le fait qu'isSuperAdmin est indépendant de user_tenant_roles —
// voir ARCHITECTURE.md BLOC 1), soit un admin_tenant explicitement rattaché à CE tenant
// (req.tenantRole résolu par tenantMiddleware, monté juste avant celui-ci).
//
// Remplace requireSuperAdmin sur GET /:tenantId/roles : cette route sert désormais
// à la fois le bootstrap (super_admin) et l'affichage de l'équipe self-service
// (TeamManagement.jsx, admin_tenant).
export async function requireSuperAdminOrTenantAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, req.user.userId),
    columns: { isSuperAdmin: true },
  });

  if (user?.isSuperAdmin) {
    next();
    return;
  }

  if (req.tenantRole === "admin_tenant") {
    next();
    return;
  }

  res.status(403).json({ error: "FORBIDDEN" });
}