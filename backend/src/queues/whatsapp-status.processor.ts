import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { connection } from "./redis-connection.js";
import type { WhatsappStatusJobData } from "./whatsapp-status.queue.js";
import { whatsappSessions } from "../db/tenant/schema.js";
import { getTenantDb } from "../db/tenant-connection-manager.js";

async function processStatusJob(job: Job<WhatsappStatusJobData>) {
  const { sessionId, tenantId, connectionStatus, phoneNumber, disconnectReason } = job.data;

  const tenantDb = await getTenantDb(tenantId);

  const updates: Partial<typeof whatsappSessions.$inferInsert> = {
    connectionStatus,
    updatedAt: new Date(),
  };

  if (phoneNumber) {
    updates.phoneNumber = phoneNumber;
  }

  if (connectionStatus === "connected") {
    updates.lastConnectedAt = new Date();
  }

  if (disconnectReason) {
    updates.lastDisconnectReason = disconnectReason;
  }

  await tenantDb
    .update(whatsappSessions)
    .set(updates)
    .where(eq(whatsappSessions.id, sessionId));

  return { sessionId, connectionStatus };
}

export const whatsappStatusWorker = new Worker<WhatsappStatusJobData>(
  "whatsapp-status",
  processStatusJob,
  { connection }
);

whatsappStatusWorker.on("completed", (job) => {
  console.log(`[status] ${job.data.connectionStatus} pour session ${job.data.sessionId}`);
});

whatsappStatusWorker.on("failed", (job, err) => {
  console.error(`[status] échec pour session ${job?.data.sessionId}:`, err.message);
});