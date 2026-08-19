import { Worker, Job } from "bullmq";
import { connection } from "./redis-connection.js";
import type { WhatsappSessionControlJobData } from "./whatsapp-session-control.queue.js";
import { sessionManager } from "../modules/whatsapp/session-manager.js";

async function processSessionControlJob(job: Job<WhatsappSessionControlJobData>) {
  const { sessionId, tenantId, action } = job.data;

  if (action === "start") {
    await sessionManager.startSession(sessionId, tenantId);
    return { sessionId, action: "started" };
  }

  if (action === "stop") {
    await sessionManager.stopSession(sessionId, tenantId);
    return { sessionId, action: "stopped" };
  }
}

export const whatsappSessionControlWorker = new Worker<WhatsappSessionControlJobData>(
  "whatsapp-session-control",
  processSessionControlJob,
  { connection }
);

whatsappSessionControlWorker.on("completed", (job) => {
  console.log(`[session-control] ${job.data.action} OK pour session ${job.data.sessionId}`);
});

whatsappSessionControlWorker.on("failed", (job, err) => {
  console.error(`[session-control] échec pour session ${job?.data.sessionId}:`, err.message);
});