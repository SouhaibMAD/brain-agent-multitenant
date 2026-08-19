// backend/src/modules/tenant-roles/tenant-roles.schemas.ts
import { z } from "zod";

// Rôles assignables par le bootstrap super_admin — super_admin lui-même est
// exclu au niveau du type même, Zod rejette donc automatiquement toute
// tentative sans passer par le check runtime USE_IS_SUPER_ADMIN_FLAG_INSTEAD
// (qui reste en place côté service comme filet, cohérent avec la double
// barrière déjà actée en BLOC 6.4).
export const assignUserRoleSchema = z.object({
  userId: z.string().uuid("userId invalide"),
  role: z.enum(["admin_tenant", "agent", "viewer"]),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["admin_tenant", "agent", "viewer"]),
});

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["agent", "viewer"]),
});

export const lookupEmailQuerySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
});

export const tenantIdUserIdParamSchema = z.object({
  tenantId: z.string().uuid("tenantId invalide"),
  userId: z.string().uuid("userId invalide"),
});