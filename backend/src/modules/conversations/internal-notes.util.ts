// src/modules/conversations/internal-notes.util.ts
//
// Format partagé pour l'historique de internalNotes — utilisé à la fois par
// appendInternalNote (conversations.service.ts, notes humaines) et
// escalateConversationToHuman (leads.service.ts, escalade agent IA), pour que
// les deux sources d'écriture s'empilent au lieu de s'écraser mutuellement
// (voir ARCHITECTURE.md BLOC 4/6 — dette résolue).

export function appendNoteEntry(
  existingNotes: string | null,
  authorLabel: string,
  content: string
): string {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${authorLabel} : ${content}`;
  return existingNotes ? `${existingNotes}\n${entry}` : entry;
}