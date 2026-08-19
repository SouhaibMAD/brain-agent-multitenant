import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

export interface ProvisionTenantJobData {
  tenantId: string;
  tenantSlug: string;
}

export const provisioningQueue = new Queue<ProvisionTenantJobData>(
  "tenant-provisioning",
  { connection }
);

export async function enqueueTenantProvisioning(
  data: ProvisionTenantJobData
) {
  await provisioningQueue.add("provision-tenant", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });
}