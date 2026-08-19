import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import { db as controlDb } from "./control/index.js";
import { tenants } from "./control/schema.js";
import * as tenantSchema from "./tenant/schema.js";

neonConfig.webSocketConstructor = ws;

type TenantDb = ReturnType<typeof drizzle<typeof tenantSchema>>;

const tenantConnectionCache = new Map<string, TenantDb>();

export async function getTenantDb(tenantId: string): Promise<TenantDb> {
  const cached = tenantConnectionCache.get(tenantId);
  if (cached) {
    return cached;
  }

  const tenant = await controlDb.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  if (!tenant.databaseUrl || tenant.provisioningStatus !== "ready") {
    throw new Error("TENANT_NOT_PROVISIONED");
  }

  const pool = new Pool({ connectionString: tenant.databaseUrl });
  const tenantDb = drizzle(pool, { schema: tenantSchema });

  tenantConnectionCache.set(tenantId, tenantDb);
  return tenantDb;
}

export function clearTenantConnectionCache(tenantId: string) {
  tenantConnectionCache.delete(tenantId);
}