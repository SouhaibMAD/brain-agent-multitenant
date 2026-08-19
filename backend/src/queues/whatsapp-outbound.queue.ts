import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

export interface WhatsappOutboundJobData {
  sessionId: string;
  to: string; // JID WhatsApp destinataire, ex: "2126xxxxxxxx@s.whatsapp.net"
  text: string;
}

export const whatsappOutboundQueue = new Queue<WhatsappOutboundJobData>(
  "whatsapp-outbound",
  { connection }
);

export async function enqueueWhatsappOutbound(data: WhatsappOutboundJobData) {
  await whatsappOutboundQueue.add("send-message", data, {
    // Fenêtre de retry élargie (5 tentatives, backoff exponentiel base
    // 4000ms) — couvre confortablement une reconnexion Baileys
    // transitoire complète : RECONNECT_DELAY_MS = 5000ms (session-manager.ts)
    // + temps de connexion réel Baileys derrière (observé variable, parfois
    // plusieurs secondes de plus).
    //
    // Avant ce changement : attempts=3, backoff 3000ms exponentiel — les
    // tentatives arrivaient à peu près t=0, t=3s, t=6s (~9s de fenêtre
    // totale), ce qui pouvait s'épuiser ENTIÈREMENT dans le trou de
    // reconnexion, provoquant un échec définitif et silencieux d'un envoi
    // manuel pourtant légitime (bug réel observé en test).
    //
    // Nouvelle fenêtre approximative : t=0, t=4s, t=8s, t=16s, t=32s
    // (~60s de fenêtre totale) — largement suffisant pour absorber une
    // coupure transitoire typique, sans pour autant retry indéfiniment
    // sur une session réellement morte (SESSION_LOGGED_OUT reste
    // UnrecoverableError, jamais retry, voir le processor).
    attempts: 5,
    backoff: { type: "exponential", delay: 4000 },
  });
}