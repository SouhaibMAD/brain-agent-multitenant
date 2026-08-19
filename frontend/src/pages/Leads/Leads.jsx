// Leads.jsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient, getErrorMessage } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./Leads.css";

const STATUS_FILTERS = [
  { value: undefined, label: "Tous" },
  { value: "nouveau", label: "Nouveau" },
  { value: "qualifie", label: "Qualifié" },
  { value: "en_attente_confirmation", label: "En attente" },
  { value: "confirme", label: "Confirmé" },
  { value: "annule", label: "Annulé" },
  { value: "transfere_humain", label: "Transféré" },
];

const STATUS_LABELS = {
  nouveau: "Nouveau",
  qualifie: "Qualifié",
  en_attente_confirmation: "En attente",
  confirme: "Confirmé",
  annule: "Annulé",
  transfere_humain: "Transféré",
};

// Options du select d'édition — mêmes valeurs que STATUS_LABELS, séparé
// pour ne pas inclure l'entrée "Tous" (value: undefined) du filtre.
const EDITABLE_STATUSES = [
  "nouveau",
  "qualifie",
  "en_attente_confirmation",
  "confirme",
  "annule",
  "transfere_humain",
];

async function fetchLeads(tenantId, status) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/leads`, {
    params: status ? { status } : undefined,
  });
  return data;
}

async function updateLeadStatus(tenantId, leadId, status) {
  const { data } = await apiClient.patch(`/tenants/${tenantId}/leads/${leadId}`, { status });
  return data;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Leads() {
  const { tenantId, slug } = useTenant();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState(undefined);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads", tenantId, statusFilter],
    queryFn: () => fetchLeads(tenantId, statusFilter),
    refetchInterval: 10000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ leadId, status }) => updateLeadStatus(tenantId, leadId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads", tenantId] });
    },
  });

  function goToConversation(conversationId) {
    if (!conversationId) return;
    navigate(`/${slug}/inbox?conversation=${conversationId}`);
  }

  function handleStatusChange(leadId, newStatus) {
    statusMutation.mutate(
      { leadId, status: newStatus },
      {
        onError: (err) => {
          // Pas de re-fetch nécessaire côté échec : le <select> revient
          // visuellement à l'ancienne valeur au prochain rendu, la donnée
          // serveur (source de vérité) n'a pas bougé.
          alert(getErrorMessage(err, "de modifier le statut de ce lead"));
        },
      }
    );
  }

  return (
    <div className="leads-page">
      <div className="leads-filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`leads-filter-btn ${statusFilter === f.value ? "active" : ""}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="leads-empty">Chargement…</div>
      ) : !leads || leads.length === 0 ? (
        <div className="leads-empty">Aucun lead pour l'instant</div>
      ) : (
        <table className="leads-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Téléphone</th>
              <th>Produit</th>
              <th>Qté</th>
              <th>Prix estimé</th>
              <th>Statut</th>
              <th>Créé le</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.customerName || "—"}</td>
                <td className="leads-mono">{lead.phone || "—"}</td>
                <td>
                  {lead.productRequested || "—"}
                  {lead.variant ? ` (${lead.variant})` : ""}
                </td>
                <td>{lead.quantity ?? "—"}</td>
                <td>{lead.estimatedPrice ? `${lead.estimatedPrice} MAD` : "—"}</td>
                <td>
                  <select
                    className={`lead-status-select lead-status-${lead.leadStatus}`}
                    value={lead.leadStatus}
                    disabled={statusMutation.isPending}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                  >
                    {EDITABLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="leads-mono">{formatDate(lead.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="leads-view-conversation-btn"
                    onClick={() => goToConversation(lead.conversationId)}
                    disabled={!lead.conversationId}
                  >
                    Voir la conversation
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}