// src/modules/leads/leads.types.ts

/** Paramètres reçus du tool call Groq (create_lead), sans channel/conversationId — ceux-ci viennent du contexte de l'appel, jamais du LLM. */
export interface CreateLeadParams {
  customerName: string;
  phone: string;
  address?: string;
  productRequested?: string;
  variant?: string;
  quantity?: number;
  estimatedPrice?: number;
}

/** Contexte connu côté service, jamais fourni par le LLM. */
export interface LeadContext {
  conversationId: string;
  channel: string;
}

export interface UpsertLeadResult {
  leadId: string;
  wasCreated: boolean; // true = insert, false = update d'un lead existant
}

// Statuts du CDC §3.10 — varchar libre en base (cohérent avec channel/direction,
// voir ARCHITECTURE.md BLOC 2), validation de l'ensemble fermé de valeurs
// déportée côté applicatif (Zod + ce type), pas de contrainte enum Postgres.
// Statut libre côté transition : pas de state machine imposée — décision
// assumée (session 14/08), l'agent/admin humain reste seul juge.
export type LeadStatus =
  | "nouveau"
  | "qualifie"
  | "en_attente_confirmation"
  | "confirme"
  | "annule"
  | "transfere_humain";

export const LEAD_STATUSES: LeadStatus[] = [
  "nouveau",
  "qualifie",
  "en_attente_confirmation",
  "confirme",
  "annule",
  "transfere_humain",
];

export interface UpdateLeadStatusInput {
  status: LeadStatus;
}