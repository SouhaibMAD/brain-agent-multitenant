import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import NotesPanel from "./NotesPanel";
import "./ConversationThread.css";

async function fetchMessages(tenantId, conversationId) {
  const { data } = await apiClient.get(
    `/tenants/${tenantId}/conversations/${conversationId}/messages`
  );
  return data;
}

function getActionErrorMessage(error, actionLabel) {
  if (error?.response?.status === 403) {
    return `Votre rôle (lecture seule) ne permet pas ${actionLabel}. Contactez un administrateur du tenant.`;
  }
  return `Échec : ${actionLabel} a échoué. Réessayez.`;
}

export default function ConversationThread({ tenantId, conversationId }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["conversation-messages", tenantId, conversationId],
    queryFn: () => fetchMessages(tenantId, conversationId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data?.messages?.length]);

  function invalidateThisConversation() {
    queryClient.invalidateQueries({
      queryKey: ["conversation-messages", tenantId, conversationId],
    });
    queryClient.invalidateQueries({ queryKey: ["conversations", tenantId] });
  }

  const sendMessage = useMutation({
    mutationFn: (content) =>
      apiClient.post(`/tenants/${tenantId}/conversations/${conversationId}/messages`, {
        content,
      }),
    onSuccess: () => {
      setDraft("");
      invalidateThisConversation();
    },
  });

  const toggleBot = useMutation({
    mutationFn: (enabled) =>
      apiClient.patch(`/tenants/${tenantId}/conversations/${conversationId}/bot`, {
        enabled,
      }),
    onSuccess: invalidateThisConversation,
  });

  const resumeConversation = useMutation({
    mutationFn: () =>
      apiClient.post(`/tenants/${tenantId}/conversations/${conversationId}/resume`),
    onSuccess: invalidateThisConversation,
  });

  if (isLoading) {
    return <div className="thread-loading">Chargement…</div>;
  }

  if (!data) {
    return <div className="thread-loading">Conversation introuvable</div>;
  }

  const { conversation, messages } = data;

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim() || sendMessage.isPending) return;
    sendMessage.mutate(draft);
  }

  return (
    <div className="thread">
      <div className="thread-header">
        <div className="thread-header-info">
          <span className="thread-customer">{conversation.customerIdentifier}</span>
          <span className="thread-channel">{conversation.channel}</span>
        </div>

        <div className="thread-header-actions">
          {conversation.status === "handover" && (
            <button
              type="button"
              className="thread-action-btn thread-resume-btn"
              onClick={() => resumeConversation.mutate()}
              disabled={resumeConversation.isPending}
            >
              {resumeConversation.isPending ? "Reprise…" : "Reprendre le bot"}
            </button>
          )}

          <label className="thread-bot-toggle">
            <input
              type="checkbox"
              checked={conversation.botEnabled}
              onChange={(e) => toggleBot.mutate(e.target.checked)}
              disabled={toggleBot.isPending}
            />
            <span>Bot {conversation.botEnabled ? "actif" : "coupé"}</span>
          </label>
        </div>
      </div>

      {(toggleBot.isError || resumeConversation.isError) && (
        <p className="thread-send-error" role="alert">
          {toggleBot.isError
            ? getActionErrorMessage(toggleBot.error, "de couper/activer le bot")
            : getActionErrorMessage(resumeConversation.error, "de reprendre la conversation")}
        </p>
      )}

      <NotesPanel
        tenantId={tenantId}
        conversationId={conversationId}
        internalNotes={conversation.internalNotes}
      />

      <div className="thread-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="thread-empty">Aucun message pour l'instant</div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`thread-message thread-message-${m.direction}`}
          >
            <div className="thread-message-bubble">
              {m.messageType === "image" && m.mediaBase64 && (
                <img
                  src={`data:${m.mediaMimeType};base64,${m.mediaBase64}`}
                  alt="Image envoyée par le client"
                  className="thread-message-image"
                />
              )}
              {m.content && <div className="thread-message-text">{m.content}</div>}
            </div>
            <div className="thread-message-time">
              {new Date(m.sentAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
      </div>

      <form className="thread-composer" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Écrire un message…"
          disabled={sendMessage.isPending}
        />
        <button type="submit" disabled={!draft.trim() || sendMessage.isPending}>
          Envoyer
        </button>
      </form>
      {sendMessage.isError && (
        <p className="thread-send-error" role="alert">
          {sendMessage.error?.response?.data?.error === "WHATSAPP_SESSION_NOT_LINKED"
            ? "Aucune session WhatsApp active pour cette conversation."
            : getActionErrorMessage(sendMessage.error, "d'envoyer un message")}
        </p>
      )}
    </div>
  );
}