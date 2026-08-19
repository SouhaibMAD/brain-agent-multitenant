import { eq } from "drizzle-orm";
import { db } from "../../db/control/index.js";
import { tenants } from "../../db/control/schema.js";
import type { CreateTenantInput } from "./tenants.types.js";
import { enqueueTenantProvisioning } from "../../queues/provisioning.queue.js";

export async function createTenant(input: CreateTenantInput) {
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, input.slug),
  });
  if (existing) {
    throw new Error("SLUG_ALREADY_EXISTS");
  }

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug,
      // databaseUrl absent -> reste null, provisioningStatus reste 'pending' (valeur par défaut)
    })
    .returning();

  if (!tenant) {
    throw new Error("TENANT_CREATION_FAILED");
  }

  // Déclenche le provisioning en arrière-plan (non bloquant pour la réponse HTTP)
  await enqueueTenantProvisioning({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
  });

  return tenant;
}

export async function listTenants() {
  return db.query.tenants.findMany();
}

export async function deactivateTenant(tenantId: string) {
  const [tenant] = await db
    .update(tenants)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  return tenant;
}