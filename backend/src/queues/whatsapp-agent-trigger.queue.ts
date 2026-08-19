import { Queue } from "bullmq";
import { connection } from "./redis-connection.js";

/**
 * Queue dédiée au déclenchement différé de l'agent IA — distincte de
 * whatsapp-inbound (qui signale "un message est arrivé"). Ici le job
 * signifie "il est temps de traiter le texte accumulé pour cette
 * conversation" (voir ARCHITECTURE.md, debounce BLOC 4/BLOC 7-9).
 *
 * Un seul job actif à la fois par conversation : le jobId est déterministe
 * (préfixé par conversationId) pour permettre de le retrouver et de
 * l'annuler facilement depuis whatsapp-inbound.processor.ts.
 */

export interface WhatsappAgentTriggerJobData {
  conversationId: string;
  sessionId: string;
  customerIdentifier: string; // JID WhatsApp (= "from"), nécessaire pour enqueue la réponse outbound
  tenantId: string;
  tenantName: string;
}

export const DEBOUNCE_DELAY_MS = 4000;

export const whatsappAgentTriggerQueue = new Queue<WhatsappAgentTriggerJobData>(
  "whatsapp-agent-trigger",
  { connection }
);

function jobIdFor(conversationId: string): string {
  return `trigger-${conversationId}`;
}

/**
 * Annule le job debounce en attente pour cette conversation, s'il existe.
 * Ne lève jamais d'exception : si le job est introuvable (déjà traité) ou
 * déjà "active" (en cours de traitement, non-annulable côté BullMQ), on
 * laisse filer silencieusement — voir justification dans
 * whatsapp-inbound.processor.ts (accumulation Redis compense le split
 * éventuel en deux lots dans ce cas rare).
 */
export async function cancelPendingTrigger(conversationId: string): Promise<void> {
  const job = await whatsappAgentTriggerQueue.getJob(jobIdFor(conversationId));
  if (!job) return;

  try {
    await job.remove();
  } catch (err) {
    console.warn(
      `[whatsapp-agent-trigger] annulation impossible pour ${conversationId} (job probablement déjà actif) :`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * (Re)programme le déclenchement de l'agent pour cette conversation, avec
 * le delay reset à DEBOUNCE_DELAY_MS. À appeler après cancelPendingTrigger
 * — l'appelant est responsable de l'ordre (annuler puis reprogrammer).
 */
export async function scheduleAgentTrigger(data: WhatsappAgentTriggerJobData): Promise<void> {
  await whatsappAgentTriggerQueue.add("agent-trigger", data, {
    jobId: jobIdFor(data.conversationId),
    delay: DEBOUNCE_DELAY_MS,
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
}