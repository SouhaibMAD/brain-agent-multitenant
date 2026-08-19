import { Worker, Job } from "bullmq";
import { eq, and, desc, ne } from "drizzle-orm";
import { connection } from "./redis-connection.js";
import type { WhatsappInboundJobData } from "./whatsapp-inbound.queue.js";
import { db as controlDb } from "../db/control/index.js";
import { tenants, whatsappCredentials } from "../db/control/schema.js";
import { conversations, messages } from "../db/tenant/schema.js";
import { getTenantDb } from "../db/tenant-connection-manager.js";
import { cancelPendingTrigger, scheduleAgentTrigger } from "./whatsapp-agent-trigger.queue.js";
import { processIncomingMessage } from "../modules/agent/agent.service.js";
import type { ProcessMessageInput } from "../modules/agent/agent.types.js";
import { enqueueWhatsappOutbound } from "./whatsapp-outbound.queue.js";

async function resolveTenantForSession(sessionId: string) {
  const cred = await controlDb.query.whatsappCredentials.findFirst({
    where: eq(whatsappCredentials.sessionId, sessionId),
  });

  if (!cred) {
    throw new Error("WHATSAPP_SESSION_NOT_LINKED_TO_TENANT");
  }

  const tenant = await controlDb.query.tenants.findFirst({
    where: eq(tenants.id, cred.tenantId),
  });

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  return { tenantId: cred.tenantId, tenantName: tenant.name };
}

async function resolveOrCreateConversation(
  tenantDb: Awaited<ReturnType<typeof getTenantDb>>,
  customerIdentifier: string,
  sessionId: string
) {
  const existing = await tenantDb.query.conversations.findFirst({
    where: and(
      eq(conversations.channel, "whatsapp"),
      eq(conversations.customerIdentifier, customerIdentifier),
      ne(conversations.status, "order")
    ),
    orderBy: [desc(conversations.createdAt)],
  });

  if (existing) {
    // Resynchronise whatsappSessionId sur CHAQUE message entrant, pas
    // seulement à la création de la conversation.
    //
    // Bug réel corrigé ici : avant ce changement, whatsappSessionId
    // n'était écrit qu'une fois, à l'INSERT initial. Si le worker
    // redémarre, qu'une session Baileys se reconnecte sous un nouvel
    // UUID (voir reconcileStaleSessionsOnStartup, whatsapp.service.ts —
    // l'ancienne session passe à "stale", mais rien ne va jamais
    // réassigner les conversations existantes vers la nouvelle session),
    // ou que la session initiale est simplement recréée, toute
    // conversation déjà existante continuait de pointer vers l'ANCIEN
    // sessionId indéfiniment. Résultat observé en test réel : l'agent
    // répond correctement (processIncomingMessage ne dépend pas de ce
    // champ), mais tout envoi — agent ou manuel — utilisant
    // conversation.whatsappSessionId (sendManualMessage,
    // handleImageMessage ci-dessous) échouait en SESSION_NOT_ACTIVE de
    // façon définitive, aucun retry ne pouvant réparer un sessionId
    // simplement obsolète.
    //
    // Le sessionId du job qui vient d'arriver est par construction la
    // preuve la plus fraîche de "quelle session sert actuellement à
    // parler à ce client" — un message qui vient d'être reçu prouve que
    // cette session est bien active côté Baileys à cet instant. On ne
    // réécrit que si la valeur diffère, pour éviter un UPDATE (et un
    // bump inutile de updatedAt) sur le chemin le plus fréquent où rien
    // n'a changé.
    if (existing.whatsappSessionId !== sessionId) {
      await tenantDb
        .update(conversations)
        .set({ whatsappSessionId: sessionId, updatedAt: new Date() })
        .where(eq(conversations.id, existing.id));
    }

    return existing.id;
  }

  const [created] = await tenantDb
    .insert(conversations)
    .values({
      channel: "whatsapp",
      customerIdentifier,
      whatsappSessionId: sessionId,
    })
    .returning({ id: conversations.id });

  return created!.id;
}

function accumulatedTextKey(conversationId: string): string {
  return `debounce:text:${conversationId}`;
}

/**
 * Chemin TEXTE (inchangé) : accumulation Redis + debounce via
 * whatsapp-agent-trigger. Voir docstring d'origine dans ARCHITECTURE.md.
 */
async function handleTextMessage(
  job: Job<WhatsappInboundJobData>,
  tenantId: string,
  tenantName: string,
  tenantDb: Awaited<ReturnType<typeof getTenantDb>>,
  conversationId: string
) {
  const { sessionId, from, text } = job.data;

  await connection.rpush(accumulatedTextKey(conversationId), text);

  await cancelPendingTrigger(conversationId);
  await scheduleAgentTrigger({
    conversationId,
    sessionId,
    customerIdentifier: from,
    tenantId,
    tenantName,
  });

  return { conversationId, accumulated: true };
}

/**
 * Chemin IMAGE (nouveau) : traitement immédiat, PAS de debounce.
 *
 * Justification (voir ARCHITECTURE.md) : regrouper une image dans la même
 * fenêtre de 4s qu'un éventuel texte accumulé aurait exigé d'étendre le
 * format de stockage Redis (actuellement une simple liste de strings) et
 * la logique de whatsapp-agent-trigger.processor.ts pour gérer un contenu
 * mixte texte+image — complexité disproportionnée pour un cas d'usage où
 * le regroupement apporte peu (un client envoie rarement plusieurs
 * screenshots avec l'intention qu'ils soient lus comme une seule phrase).
 *
 * On annule d'abord un éventuel trigger texte en attente pour cette
 * conversation — s'il y avait du texte accumulé juste avant l'image (ex:
 * "regardez cette photo" suivi de l'image), on le récupère et on le
 * préfixe à la caption de l'image plutôt que de le perdre ou de le
 * traiter dans un appel séparé désynchronisé.
 */
async function handleImageMessage(
  job: Job<WhatsappInboundJobData>,
  tenantId: string,
  tenantName: string,
  tenantDb: Awaited<ReturnType<typeof getTenantDb>>,
  conversationId: string
) {
  const { sessionId, from, text, mediaBase64, mediaMimeType } = job.data;

  await cancelPendingTrigger(conversationId);

  // Récupère un éventuel texte déjà accumulé juste avant cette image
  // (ex: "regarde cette photo" puis l'image envoyée juste après) et le
  // fusionne avec la caption plutôt que de le perdre.
  const key = accumulatedTextKey(conversationId);
  const pendingParts = await connection.lrange(key, 0, -1);
  await connection.del(key);

  const combinedCaption = [...pendingParts, text].filter(Boolean).join("\n");

 const processInput: ProcessMessageInput = {
  conversationId,
  channel: "whatsapp",
  incomingContent: combinedCaption,
  ...(mediaBase64 && mediaMimeType ? { image: { base64: mediaBase64, mimeType: mediaMimeType } } : {}),
};

const result = await processIncomingMessage(tenantDb, processInput, tenantName);

  if (!result.skipped && result.assistantReply !== undefined && result.assistantReply !== '') {
    await enqueueWhatsappOutbound({
      sessionId,
      to: from,
      text: result.assistantReply,
    });
  }

  return { conversationId, skipped: result.skipped };
}

async function processInboundJob(job: Job<WhatsappInboundJobData>) {
  const { sessionId, from, messageType } = job.data;

  const { tenantId, tenantName } = await resolveTenantForSession(sessionId);
  const tenantDb = await getTenantDb(tenantId);
  const conversationId = await resolveOrCreateConversation(tenantDb, from, sessionId);

  if (messageType === "image") {
    return handleImageMessage(job, tenantId, tenantName, tenantDb, conversationId);
  }

  return handleTextMessage(job, tenantId, tenantName, tenantDb, conversationId);
}

export const whatsappInboundWorker = new Worker<WhatsappInboundJobData>(
  "whatsapp-inbound",
  processInboundJob,
  { connection }
);

whatsappInboundWorker.on("completed", (job) => {
  console.log(`[inbound] traité, session ${job.data.sessionId}, type=${job.data.messageType}`);
});

whatsappInboundWorker.on("failed", (job, err) => {
  console.error(`[inbound] échec, session ${job?.data.sessionId}:`, err.message);
});