// backend\src\modules\tenant-roles\tenant-roles.service.ts:
import { eq, and } from "drizzle-orm";
import { db } from "../../db/control/index.js";
import { users, tenants, userTenantRoles } from "../../db/control/schema.js";
import type { AssignUserRoleInput, InviteUserToTenantInput, AssignableRole } from "./tenant-roles.types.js";

// Valeur historique de l'enum `role`, exclue de cet endpoint : le statut super_admin
// est un flag plateforme global (users.isSuperAdmin), indépendant de tout tenant —
// voir ARCHITECTURE.md, BLOC 1, section "Statut super_admin". La valeur reste dans
// l'enum Postgres pour compatibilité mais ne doit plus être assignée via ce chemin.
const REJECTED_ROLE = "super_admin";
const ASSIGNABLE_ROLES: AssignableRole[] = ["admin_tenant", "agent", "viewer"];

export async function assignUserRoleToTenant(
  tenantId: string,
  input: AssignUserRoleInput
) {
    if (typeof input.userId !== "string" || input.userId.trim() === "") {
    throw new Error("INVALID_OR_MISSING_USER_ID");
  }

  if (typeof input.role !== "string" || input.role.trim() === "") {
    throw new Error("INVALID_OR_MISSING_ROLE");
  }

  if ((input.role as string) === REJECTED_ROLE) {
    throw new Error("USE_IS_SUPER_ADMIN_FLAG_INSTEAD");
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const existing = await db.query.userTenantRoles.findFirst({
    where: and(
      eq(userTenantRoles.userId, input.userId),
      eq(userTenantRoles.tenantId, tenantId)
    ),
  });
  if (existing) {
    throw new Error("USER_ALREADY_HAS_ROLE_ON_TENANT");
  }

  const [link] = await db
    .insert(userTenantRoles)
    .values({
      userId: input.userId,
      tenantId,
      role: input.role,
    })
    .returning();

  if (!link) {
    throw new Error("ROLE_ASSIGNMENT_FAILED");
  }

  return link;
}

// Jointure vers users : l'UUID seul n'est pas exploitable côté UI, l'email est
// ce qu'un admin reconnaît réellement pour identifier un membre de son équipe.
export async function listUserRolesForTenant(tenantId: string) {
  const rows = await db
    .select({
      id: userTenantRoles.id,
      userId: userTenantRoles.userId,
      email: users.email,
      fullName: users.fullName,
      role: userTenantRoles.role,
      createdAt: userTenantRoles.createdAt,
    })
    .from(userTenantRoles)
    .innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(eq(userTenantRoles.tenantId, tenantId));

  return rows;
}

export async function updateUserRoleOnTenant(
  tenantId: string,
  userId: string,
  role: string
) {
  if (typeof role !== "string" || role.trim() === "") {
    throw new Error("INVALID_OR_MISSING_ROLE");
  }

  if (role === REJECTED_ROLE) {
    throw new Error("USE_IS_SUPER_ADMIN_FLAG_INSTEAD");
  }

  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new Error("INVALID_OR_MISSING_ROLE");
  }

  const existing = await db.query.userTenantRoles.findFirst({
    where: and(
      eq(userTenantRoles.userId, userId),
      eq(userTenantRoles.tenantId, tenantId)
    ),
  });

  if (!existing) {
    throw new Error("ROLE_LINK_NOT_FOUND");
  }

  const [updated] = await db
    .update(userTenantRoles)
    .set({ role: role as AssignableRole })
    .where(eq(userTenantRoles.id, existing.id))
    .returning();

  if (!updated) {
    throw new Error("ROLE_UPDATE_FAILED");
  }

  return updated;
}

// Sens inverse de listUserRolesForTenant : "quels tenants cet utilisateur peut-il voir",
// nécessaire pour le sélecteur de tenant post-login (CDC §3.1, association user↔plusieurs
// tenants). Jointure vers `tenants` car le frontend a besoin du nom/slug d'affichage,
// pas seulement du tenantId brut que porte userTenantRoles.
export async function listTenantsForUser(userId: string) {
  const rows = await db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      role: userTenantRoles.role,
    })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(tenants.id, userTenantRoles.tenantId))
    .where(eq(userTenantRoles.userId, userId));
 
  return rows;
}
 
export async function inviteUserToTenant(input: InviteUserToTenantInput) {
  const { tenantId, email, role } = input;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const existingLink = await db.query.userTenantRoles.findFirst({
    where: and(
      eq(userTenantRoles.userId, user.id),
      eq(userTenantRoles.tenantId, tenantId)
    ),
  });

  if (existingLink) {
    throw new Error("USER_ALREADY_HAS_ROLE_ON_TENANT");
  }

  const [inserted] = await db
    .insert(userTenantRoles)
    .values({
      userId: user.id,
      tenantId,
      role,
    })
    .returning();

  if (!inserted) {
    throw new Error("INTERNAL_ERROR");
  }

  return inserted;
}

export async function lookupUserByEmail(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, email: true, fullName: true, isSuperAdmin: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
} 

export async function removeUserRoleFromTenant(tenantId: string, userId: string) {
  const existing = await db.query.userTenantRoles.findFirst({
    where: and(
      eq(userTenantRoles.userId, userId),
      eq(userTenantRoles.tenantId, tenantId)
    ),
  });

  if (!existing) {
    throw new Error("ROLE_LINK_NOT_FOUND");
  }

  await db.delete(userTenantRoles).where(eq(userTenantRoles.id, existing.id));
}
