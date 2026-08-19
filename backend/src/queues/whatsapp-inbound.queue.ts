import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

export interface WhatsappInboundJobData {
  sessionId: string;
  from: string; // JID WhatsApp expéditeur
  text: string; // caption si image, texte si message texte (peut être vide pour une image sans légende)
  messageType: "text" | "image";
  mediaBase64?: string; // présent uniquement si messageType === 'image'
  mediaMimeType?: string; // présent uniquement si messageType === 'image'
  receivedAt: string; // ISO timestamp
}

export const whatsappInboundQueue = new Queue<WhatsappInboundJobData>(
  "whatsapp-inbound",
  { connection }
);

export async function enqueueWhatsappInbound(data: WhatsappInboundJobData) {
  await whatsappInboundQueue.add("incoming-message", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
}