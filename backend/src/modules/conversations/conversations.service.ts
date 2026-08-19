// conversations.service.ts:
import { eq, sql as rawSql } from "drizzle-orm";
import { conversations, messages } from "../../db/tenant/schema.js";
import { getTenantDb } from "../../db/tenant-connection-manager.js";
import { enqueueWhatsappOutbound } from "../../queues/whatsapp-outbound.queue.js";
import type { SendManualMessageResult, ToggleBotResult, ResumeConversationResult } from "./conversations.types.js";
import type { ConversationListItem, ConversationMessagesResult } from "./conversations.types.js";
import { appendNoteEntry } from "./internal-notes.util.js";

export async function sendManualMessage(
  tenantId: string,
  conversationId: string,
  content: string
): Promise<SendManualMessageResult> {
  const tenantDb = await getTenantDb(tenantId);

  const conversation = await tenantDb.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  // Dispatch par canal — seul whatsapp est implémenté à ce stade.
  // Les futurs canaux (BLOC 8 : Facebook, Instagram) ajouteront leur
  // propre branche ici, sans changer le contrat de cet endpoint.
  if (conversation.channel === "whatsapp") {
    if (!conversation.whatsappSessionId) {
      throw new Error("WHATSAPP_SESSION_NOT_LINKED");
    }

    await enqueueWhatsappOutbound({
      sessionId: conversation.whatsappSessionId,
      to: conversation.customerIdentifier,
      text: content,
    });
  } else {
    throw new Error("CHANNEL_NOT_SUPPORTED_FOR_MANUAL_SEND");
  }

  const [created] = await tenantDb
    .insert(messages)
    .values({
      conversationId,
      direction: "outbound",
      content,
      messageType: "text",
    })
    .returning({ id: messages.id });

  return { messageId: created!.id, conversationId };
}
export async function toggleBotForConversation(
  tenantId: string,
  conversationId: string,
  enabled: boolean
): Promise<ToggleBotResult> {
  const tenantDb = await getTenantDb(tenantId);

  const conversation = await tenantDb.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  await tenantDb
    .update(conversations)
    .set({ botEnabled: enabled, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { conversationId, botEnabled: enabled };
}
export async function resumeConversationFromHandover(
  tenantId: string,
  conversationId: string
): Promise<ResumeConversationResult> {
  const tenantDb = await getTenantDb(tenantId);

  const conversation = await tenantDb.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  if (conversation.status !== "handover") {
    throw new Error("CONVERSATION_NOT_IN_HANDOVER");
  }

  await tenantDb
    .update(conversations)
    .set({ status: "bot_active", updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { conversationId, status: "bot_active" };
}
 
// Liste les conversations d'un tenant, triées par activité récente réelle
// (MAX(messages.sentAt), pas conversations.updatedAt qui ne suit pas fidèlement
// l'arrivée de nouveaux messages aujourd'hui). Filtre optionnel par statut,
// nécessaire pour l'onglet "handover" de l'inbox (CDC §5).

export async function listConversations(
  tenantId: string,
  statusFilter?: string
): Promise<ConversationListItem[]> {
  const tenantDb = await getTenantDb(tenantId);
 
  const statusCondition = statusFilter
    ? rawSql`WHERE c.status = ${statusFilter}`
    : rawSql``;
 
  const rows = await tenantDb.execute(rawSql`
    SELECT
      c.id,
      c.channel,
      c.status,
      c.customer_identifier AS "customerIdentifier",
      c.bot_enabled AS "botEnabled",
      lead.customer_name AS "leadCustomerName",
      last_msg.content AS "lastMessageContent",
      last_msg.direction AS "lastMessageDirection",
      last_msg.sent_at AS "lastMessageAt"
    FROM conversations c
    LEFT JOIN LATERAL (
      SELECT content, direction, sent_at
      FROM messages
      WHERE messages.conversation_id = c.id
      ORDER BY sent_at DESC
      LIMIT 1
    ) last_msg ON true
    LEFT JOIN LATERAL (
      -- Un lead peut en théorie être recréé/mis à jour (upsert par conversationId,
      -- voir leads.service.ts) — on prend le plus récent par sécurité, même si en
      -- pratique il ne devrait y en avoir qu'un actif par conversation.
      SELECT customer_name
      FROM leads
      WHERE leads.conversation_id = c.id AND leads.customer_name IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    ) lead ON true
    ${statusCondition}
    ORDER BY last_msg.sent_at DESC NULLS LAST
  `);
 
  return rows.rows as unknown as ConversationListItem[];
}
 
 
// Historique complet des messages d'une conversation, ordre chronologique
// (ordre "naturel de lecture" pour un thread, contrairement à listConversations
// qui veut le plus récent en premier).
export async function getConversationMessages(
  tenantId: string,
  conversationId: string
): Promise<ConversationMessagesResult> {
  const tenantDb = await getTenantDb(tenantId);
 
  const conversation = await tenantDb.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }
 
  const history = await tenantDb.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: (messages, { asc }) => [asc(messages.sentAt)],
  });
 
  return { conversation, messages: history };
}
 

// --- Ajout à conversations.service.ts ---

// Ajoute une note humaine à internalNotes SANS écraser l'existant (ex: la raison
// d'escalade automatique écrite par escalate_to_human, agent.service.ts) — dette
// notée dans ARCHITECTURE.md BLOC 4, résolue ici par un historique horodaté
// concaténé plutôt qu'un écrasement.

export async function appendInternalNote(
  tenantId: string,
  conversationId: string,
  authorLabel: string,
  noteContent: string
): Promise<{ conversationId: string; internalNotes: string }> {
  const tenantDb = await getTenantDb(tenantId);

  const conversation = await tenantDb.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const updatedNotes = appendNoteEntry(conversation.internalNotes, authorLabel, noteContent);

  await tenantDb
    .update(conversations)
    .set({ internalNotes: updatedNotes, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { conversationId, internalNotes: updatedNotes };
}