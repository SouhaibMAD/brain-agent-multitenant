// src/modules/leads/leads.service.ts

import { eq, desc } from 'drizzle-orm';
import { leads, conversations } from '../../db/tenant/schema.js';
import type { LeadStatus } from "./leads.types.js";
import type { getTenantDb } from '../../db/tenant-connection-manager.js';
import type { CreateLeadParams, LeadContext, UpsertLeadResult } from './leads.types.js';
import { appendNoteEntry } from "../conversations/internal-notes.util.js";

type TenantDb = Awaited<ReturnType<typeof getTenantDb>>;

/**
 * src/modules/leads/leads.service.ts
 *
 * Upsert de lead déclenché par l'agent IA (BLOC 4), en anticipation de
 * BLOC 6 (interface leads complète, non encore codée).
 *
 * Règle : un seul lead par conversation. Si un lead existe déjà pour
 * conversationId, on le met à jour (les nouvelles infos remplacent les
 * anciennes, champ par champ, seulement si fournies) plutôt que d'en
 * créer un second — une conversation représente une seule intention
 * d'achat en cours à la fois en V1.
 *
 * Effet de bord assumé : passe conversations.status à 'lead' à chaque
 * upsert réussi (création ou mise à jour), dans la même transaction.
 */
export async function upsertLeadForConversation(
  db: TenantDb,
  params: CreateLeadParams,
  context: LeadContext
): Promise<UpsertLeadResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.conversationId, context.conversationId))
      .limit(1);

    let leadId: string;
    let wasCreated: boolean;

    if (existing) {
      await tx
        .update(leads)
        .set({
          customerName: params.customerName,
          phone: params.phone,
          address: params.address,
          productRequested: params.productRequested,
          variant: params.variant,
          quantity: params.quantity,
          estimatedPrice: params.estimatedPrice?.toString(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, existing.id));
      leadId = existing.id;
      wasCreated = false;
    } else {
      const [inserted] = await tx
        .insert(leads)
        .values({
          conversationId: context.conversationId,
          customerName: params.customerName,
          phone: params.phone,
          address: params.address,
          productRequested: params.productRequested,
          variant: params.variant,
          quantity: params.quantity,
          estimatedPrice: params.estimatedPrice?.toString(),
          channel: context.channel,
          leadStatus: 'nouveau',
        })
        .returning({ id: leads.id });
      leadId = inserted!.id;
      wasCreated = true;
    }

    await tx
      .update(conversations)
      .set({ status: 'lead', updatedAt: new Date() })
      .where(eq(conversations.id, context.conversationId));

    return { leadId, wasCreated };
  });
}

/**
 * Marque une conversation comme nécessitant une reprise humaine (handover).
 * Empile le motif fourni par l'agent dans internalNotes (au lieu de l'écraser
 * — voir internal-notes.util.ts) pour donner du contexte immédiat à l'humain
 * qui reprend, sans effacer d'éventuelles notes humaines déjà présentes.
 */
export async function escalateConversationToHuman(
  db: TenantDb,
  conversationId: string,
  reason: string
): Promise<void> {
  const [conversation] = await db
    .select({ internalNotes: conversations.internalNotes })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
 
  const updatedNotes = appendNoteEntry(
    conversation?.internalNotes ?? null,
    "Agent IA",
    reason
  );
 
  await db
    .update(conversations)
    .set({
      status: "handover",
      internalNotes: updatedNotes,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}
 

// --- Ajout à leads.service.ts ---
 
export interface LeadListItem {
  id: string;
  customerName: string | null;
  phone: string | null;
  productRequested: string | null;
  variant: string | null;
  quantity: number | null;
  estimatedPrice: string | null;
  leadStatus: string;
  channel: string;
  conversationId: string | null;
  createdAt: Date;
}
 
// Liste les leads d'un tenant, triés par activité récente. Filtre optionnel
// par leadStatus ('nouveau' | 'qualifie' | 'transfere_humain') pour un futur
// filtre UI, cohérent avec le filtre par statut déjà en place sur l'Inbox.
export async function listLeads(
  db: TenantDb,
  statusFilter?: string
): Promise<LeadListItem[]> {
  const rows = statusFilter
    ? await db
        .select()
        .from(leads)
        .where(eq(leads.leadStatus, statusFilter))
        .orderBy(desc(leads.updatedAt))
    : await db.select().from(leads).orderBy(desc(leads.updatedAt));
 
  return rows;
}
 
/**
 * Mise à jour manuelle du statut d'un lead (agent/admin) — comble le trou
 * du cycle de vie : jusqu'ici seul upsertLeadForConversation() écrivait
 * leadStatus, et uniquement à 'nouveau' (création par l'agent IA). Aucun
 * chemin de code ne le faisait jamais évoluer ensuite.
 */
export async function updateLeadStatus(
  db: TenantDb,
  leadId: string,
  status: LeadStatus
) {
  const [updated] = await db
    .update(leads)
    .set({ leadStatus: status, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning();

  if (!updated) {
    throw new Error("LEAD_NOT_FOUND");
  }

  return updated;
}