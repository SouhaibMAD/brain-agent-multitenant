import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

export interface WhatsappSessionControlJobData {
  sessionId: string;
  tenantId: string;
  action: "start" | "stop";
}

export const whatsappSessionControlQueue = new Queue<WhatsappSessionControlJobData>(
  "whatsapp-session-control",
  { connection }
);

export async function enqueueWhatsappSessionControl(
  data: WhatsappSessionControlJobData
) {
  await whatsappSessionControlQueue.add("session-control", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
}