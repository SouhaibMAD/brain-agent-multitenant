import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

export interface WhatsappStatusJobData {
  sessionId: string;
  tenantId: string; // nouveau — évite de dépendre de whatsapp_credentials pour résoudre le tenant (fragile au moment d'un logout, où les creds viennent d'être supprimées)
  connectionStatus: "pending_qr" | "connected" | "disconnected" | "logged_out";
  phoneNumber?: string; // rempli une fois connecté
  disconnectReason?: string;
}

export const whatsappStatusQueue = new Queue<WhatsappStatusJobData>(
  "whatsapp-status",
  { connection }
);

export async function enqueueWhatsappStatus(data: WhatsappStatusJobData) {
  await whatsappStatusQueue.add("status-update", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
}