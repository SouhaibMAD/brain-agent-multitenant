import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import "./NotesPanel.css";

export default function NotesPanel({ tenantId, conversationId, internalNotes }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const addNote = useMutation({
    mutationFn: (content) =>
      apiClient.patch(`/tenants/${tenantId}/conversations/${conversationId}/notes`, {
        content,
      }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({
        queryKey: ["conversation-messages", tenantId, conversationId],
      });
    },
  });

  // Chaque ligne de l'historique est de la forme "[timestamp] auteur : contenu"
  // (voir appendInternalNote, conversations.service.ts) — on parse juste pour
  // un rendu plus lisible, mais la donnée brute stockée reste du texte simple.
  const noteLines = internalNotes ? internalNotes.split("\n").filter(Boolean) : [];

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim() || addNote.isPending) return;
    addNote.mutate(draft.trim());
  }

  return (
    <div className="notes-panel">
      <button
        type="button"
        className="notes-panel-toggle"
        onClick={() => setIsOpen((v) => !v)}
      >
        Notes internes {noteLines.length > 0 ? `(${noteLines.length})` : ""}
        <span className={`notes-panel-chevron ${isOpen ? "open" : ""}`}>▾</span>
      </button>

      {isOpen && (
        <div className="notes-panel-body">
          {noteLines.length === 0 ? (
            <p className="notes-panel-empty">Aucune note pour l'instant.</p>
          ) : (
            <ul className="notes-panel-list">
              {noteLines.map((line, i) => (
                <li key={i} className="notes-panel-item">
                  {line}
                </li>
              ))}
            </ul>
          )}

          <form className="notes-panel-form" onSubmit={handleSubmit}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ajouter une note…"
              rows={2}
              disabled={addNote.isPending}
            />
            <button type="submit" disabled={!draft.trim() || addNote.isPending}>
              {addNote.isPending ? "Ajout…" : "Ajouter"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}