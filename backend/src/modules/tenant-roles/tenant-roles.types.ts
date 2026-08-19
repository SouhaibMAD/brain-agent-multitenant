// backend\src\modules\tenant-roles\tenant-roles.types.ts:
// Rôles assignables via cet endpoint — super_admin exclu volontairement,
// voir tenant-roles.service.ts pour la justification
export type AssignableRole = "admin_tenant" | "agent" | "viewer";

export interface AssignUserRoleInput {
  userId: string;
  role: AssignableRole;
}

export type SelfServiceAssignableRole = "agent" | "viewer";

export interface InviteUserToTenantInput {
  tenantId: string;
  email: string;
  role: SelfServiceAssignableRole;
}

export interface UpdateUserRoleInput {
  role: AssignableRole;
}