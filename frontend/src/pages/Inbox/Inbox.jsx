import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import ConversationList from "./ConversationList";
import ConversationThread from "./ConversationThread";
import "./Inbox.css";

const STATUS_FILTERS = [
  { value: "all", label: "Toutes" },
  { value: "bot_active", label: "Bot actif" },
  { value: "lead", label: "Lead" },
  { value: "handover", label: "En attente humaine" },
];

const VALID_STATUS_VALUES = STATUS_FILTERS.map((f) => f.value);

async function fetchConversations(tenantId, status) {
  const params = status && status !== "all" ? { status } : {};
  const { data } = await apiClient.get(`/tenants/${tenantId}/conversations`, { params });
  return data;
}

export default function Inbox() {
  const tenant = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("conversation");

  // Filtre initial lu depuis ?status= (ex: lien "En attente humaine" depuis la
  // sidebar) — sinon "all" par défaut, cohérent avec le comportement existant.
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState(
    VALID_STATUS_VALUES.includes(initialStatus) ? initialStatus : "all"
  );

  // Arrivée par lien direct (?conversation=) : le filtre repart à "Toutes" pour
  // garantir que la conversation ciblée reste visible quel que soit son statut réel.
  useEffect(() => {
    if (selectedId) {
      setStatusFilter("all");
    }
  }, [selectedId]);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", tenant.tenantId, statusFilter],
    queryFn: () => fetchConversations(tenant.tenantId, statusFilter),
    refetchInterval: 5000,
  });

  function handleSelect(id) {
    setSearchParams({ conversation: id });
  }

  return (
    <div className="inbox-shell">
      <div className="inbox-list-pane">
        <div className="inbox-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`inbox-filter-btn${statusFilter === f.value ? " active" : ""}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
      <div className="inbox-thread-pane">
        {selectedId ? (
          <ConversationThread tenantId={tenant.tenantId} conversationId={selectedId} />
        ) : (
          <div className="inbox-empty-state">Sélectionnez une conversation</div>
        )}
      </div>
    </div>
  );
}