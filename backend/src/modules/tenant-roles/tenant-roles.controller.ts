import type { Request, Response } from "express";
import {
  assignUserRoleToTenant,
  listUserRolesForTenant,
  listTenantsForUser,
  inviteUserToTenant,
  lookupUserByEmail,
  updateUserRoleOnTenant,
  removeUserRoleFromTenant
} from "./tenant-roles.service.js";
import type { SelfServiceAssignableRole } from "./tenant-roles.types.js";

export async function assignUserRoleHandler(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
      return;
    }

    const link = await assignUserRoleToTenant(tenantId, req.body);
    res.status(201).json(link);
  } catch (err) {
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "USER_NOT_FOUND") {
      res.status(404).json({ error: "USER_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "USER_ALREADY_HAS_ROLE_ON_TENANT") {
      res.status(409).json({ error: "USER_ALREADY_HAS_ROLE_ON_TENANT" });
      return;
    }
    if (err instanceof Error && err.message === "INVALID_OR_MISSING_USER_ID") {
      res.status(400).json({ error: "INVALID_OR_MISSING_USER_ID" });
      return;
    }
    if (err instanceof Error && err.message === "INVALID_OR_MISSING_ROLE") {
      res.status(400).json({ error: "INVALID_OR_MISSING_ROLE" });
      return;
    }

    if (err instanceof Error && err.message === "USE_IS_SUPER_ADMIN_FLAG_INSTEAD") {
      res.status(400).json({ error: "USE_IS_SUPER_ADMIN_FLAG_INSTEAD" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function listUserRolesHandler(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.params;
  if (typeof tenantId !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
    return;
  }

  const links = await listUserRolesForTenant(tenantId);
  res.status(200).json(links);
}

// GET /api/tenants/my — tenants accessibles à l'utilisateur connecté (authMiddleware
// seul, pas requireSuperAdmin : n'importe quel user doit voir SES tenants, pas ceux
// de tout le monde). req.user garanti présent par authMiddleware en amont.
export async function listMyTenantsHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const tenantList = await listTenantsForUser(userId);
  res.status(200).json(tenantList);
}

export async function lookupUserByEmailHandler(req: Request, res: Response): Promise<void> {
  const email = req.query.email;

  if (typeof email !== "string" || email.trim() === "") {
    res.status(400).json({ error: "INVALID_OR_MISSING_EMAIL" });
    return;
  }

  try {
    const user = await lookupUserByEmail(email.trim());
    res.status(200).json(user);
  } catch (err) {
    if (err instanceof Error && err.message === "USER_NOT_FOUND") {
      res.status(404).json({ error: "USER_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

const SELF_SERVICE_ROLES: SelfServiceAssignableRole[] = ["agent", "viewer"];

export async function inviteUserToTenantController(req: Request, res: Response): Promise<void> {
  const { tenantId } = req.params;
  const { email, role } = req.body;

  if (typeof tenantId !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
    return;
  }

  if (typeof email !== "string" || email.trim() === "") {
    res.status(400).json({ error: "INVALID_OR_MISSING_EMAIL" });
    return;
  }

  if (typeof role !== "string" || !SELF_SERVICE_ROLES.includes(role as SelfServiceAssignableRole)) {
    res.status(400).json({ error: "INVALID_ROLE_MUST_BE_AGENT_OR_VIEWER" });
    return;
  }

  try {
    const link = await inviteUserToTenant({ tenantId, email, role: role as SelfServiceAssignableRole });
    res.status(201).json(link);
  } catch (err) {
    if (err instanceof Error && err.message === "USER_NOT_FOUND") {
      res.status(404).json({ error: "USER_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "USER_ALREADY_HAS_ROLE_ON_TENANT") {
      res.status(409).json({ error: "USER_ALREADY_HAS_ROLE_ON_TENANT" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function updateUserRoleHandler(req: Request, res: Response): Promise<void> {
  const { tenantId, userId } = req.params;
  const { role } = req.body;

  if (typeof tenantId !== "string" || typeof userId !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
    return;
  }

  try {
    const updated = await updateUserRoleOnTenant(tenantId, userId, role);
    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "ROLE_LINK_NOT_FOUND") {
      res.status(404).json({ error: "ROLE_LINK_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "INVALID_OR_MISSING_ROLE") {
      res.status(400).json({ error: "INVALID_OR_MISSING_ROLE" });
      return;
    }
    if (err instanceof Error && err.message === "USE_IS_SUPER_ADMIN_FLAG_INSTEAD") {
      res.status(400).json({ error: "USE_IS_SUPER_ADMIN_FLAG_INSTEAD" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function removeUserRoleHandler(req: Request, res: Response): Promise<void> {
  const { tenantId, userId } = req.params;

  if (typeof tenantId !== "string" || typeof userId !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
    return;
  }

  try {
    await removeUserRoleFromTenant(tenantId, userId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof Error && err.message === "ROLE_LINK_NOT_FOUND") {
      res.status(404).json({ error: "ROLE_LINK_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}