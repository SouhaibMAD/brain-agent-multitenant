import { Worker, Job } from "bullmq";
import { connection } from "./redis-connection.js";
import type { WhatsappAgentTriggerJobData } from "./whatsapp-agent-trigger.queue.js";
import { getTenantDb } from "../db/tenant-connection-manager.js";
import { processIncomingMessage } from "../modules/agent/agent.service.js";
import { enqueueWhatsappOutbound } from "./whatsapp-outbound.queue.js";
import { connection as redisConnection } from "./redis-connection.js";

function accumulatedTextKey(conversationId: string): string {
  return `debounce:text:${conversationId}`;
}

/**
 * Lit tout le texte accumulé pour cette conversation depuis Redis (RPUSH
 * côté whatsapp-inbound.processor.ts), le supprime (évite qu'un message
 * déjà traité soit repris par un futur cycle), et le concatène en un seul
 * bloc — un client qui écrit en rafale ("Bonjour" / "Je cherche une robe"
 * / "En taille M svp") doit être traité comme un seul tour de
 * conversation cohérent, pas 3 appels agent séparés (voir
 * ARCHITECTURE.md, dette BLOC 4).
 */
async function consumeAccumulatedText(conversationId: string): Promise<string> {
  const key = accumulatedTextKey(conversationId);

  // MULTI/EXEC : LRANGE + DEL exécutés atomiquement, aucun RPUSH concurrent
  // ne peut s'intercaler entre lecture et suppression — élimine la race
  // condition où un message arrivant pile entre les deux commandes serait
  // supprimé sans jamais avoir été lu (perte silencieuse).
  const multi = redisConnection.multi();
  multi.lrange(key, 0, -1);
  multi.del(key);
  const results = await multi.exec();

  if (!results) {
    return "";
  }

  const [lrangeResult] = results;
  const parts = (lrangeResult?.[1] as string[]) ?? [];
  return parts.join("\n");
}

async function processAgentTriggerJob(job: Job<WhatsappAgentTriggerJobData>) {
  const { conversationId, sessionId, customerIdentifier, tenantId, tenantName } = job.data;

  const combinedText = await consumeAccumulatedText(conversationId);

  if (!combinedText) {
    // Rien à traiter (cas théorique — le job n'aurait pas dû être
    // programmé sans texte accumulé, mais on reste défensif plutôt que
    // de planter sur un message vide envoyé à Groq).
    console.warn(`[agent-trigger] aucun texte accumulé pour ${conversationId}, job ignoré`);
    return { conversationId, skipped: true };
  }

  const tenantDb = await getTenantDb(tenantId);
  const result = await processIncomingMessage(
    tenantDb,
    { conversationId, channel: "whatsapp", incomingContent: combinedText },
    tenantName
  );

  if (!result.skipped && result.assistantReply !== undefined && result.assistantReply !== '') {
    await enqueueWhatsappOutbound({
      sessionId,
      to: customerIdentifier,
      text: result.assistantReply,
    });
  }

  return { conversationId, skipped: result.skipped };
}

export const whatsappAgentTriggerWorker = new Worker<WhatsappAgentTriggerJobData>(
  "whatsapp-agent-trigger",
  processAgentTriggerJob,
  { connection }
);

whatsappAgentTriggerWorker.on("completed", (job) => {
  console.log(`[agent-trigger] traité, conversation ${job.data.conversationId}`);
});

whatsappAgentTriggerWorker.on("failed", (job, err) => {
  console.error(`[agent-trigger] échec, conversation ${job?.data.conversationId}:`, err.message);
});