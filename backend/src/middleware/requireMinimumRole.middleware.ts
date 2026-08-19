import type { Request, Response, NextFunction } from "express";

type TenantRole = "super_admin" | "admin_tenant" | "agent" | "viewer";

// Garde de rôle générique pour les routes métier tenant-scopées. Suppose que
// tenantMiddleware a déjà tourné avant lui — c'est lui qui résout req.tenantRole
// depuis user_tenant_roles.
//
// Volontairement PAS de bypass isSuperAdmin ici, contrairement à
// requireSuperAdminOrTenantAdmin (GET /:tenantId/roles) : un super_admin sans
// ligne user_tenant_roles explicite sur ce tenant n'a accès qu'à la gestion
// plateforme (/admin/tenants, assignation de rôles), jamais aux données métier
// (inbox, catalogue, whatsapp) d'un tenant sur lequel il n'a pas de rôle réel.
// Décision actée en session — voir ARCHITECTURE.md, section RBAC.
export function requireMinimumRole(...allowedRoles: TenantRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenantRole || !allowedRoles.includes(req.tenantRole)) {
      res.status(403).json({ error: "INSUFFICIENT_ROLE" });
      return;
    }
    next();
  };
}