import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./AgentConfig.css";

async function fetchAgentConfig(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/agent/config`);
  return data;
}

export default function AgentConfig() {
  const tenant = useTenant();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["agent-config", tenant.tenantId],
    queryFn: () => fetchAgentConfig(tenant.tenantId),
  });

  async function handleCopy() {
    if (!data?.systemPrompt) return;
    await navigator.clipboard.writeText(data.systemPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) {
    return <div className="agent-config-page agent-config-loading">Chargement…</div>;
  }

  if (isError || !data) {
    return (
      <div className="agent-config-page agent-config-error">
        Impossible de charger la configuration de l'agent.
      </div>
    );
  }

  return (
    <div className="agent-config-page">
      <header className="agent-config-header">
        <h1>Configuration agent IA</h1>
        <p className="agent-config-subtitle">
          Prompt système actif pour <strong>{data.tenantName}</strong>
        </p>
      </header>

      <section className="agent-config-card">
        <div className="agent-config-card-header">
          <span className="agent-config-label">Prompt système (lecture seule)</span>
          <button type="button" className="agent-config-copy-btn" onClick={handleCopy}>
            {copied ? "Copié !" : "Copier"}
          </button>
        </div>
        <pre className="agent-config-prompt">{data.systemPrompt}</pre>
      </section>

      <section className="agent-config-info">
        <div className="agent-config-info-row">
          <span className="agent-config-info-badge agent-config-info-badge--dynamic">Dynamique</span>
          <span>
            Le nom du tenant (<strong>{data.tenantName}</strong>) est injecté automatiquement
            à chaque appel de l'agent — toujours à jour, sans action requise.
          </span>
        </div>
        <div className="agent-config-info-row">
          <span className="agent-config-info-badge agent-config-info-badge--fixed">Fixe</span>
          <span>
            Les règles métier (langue, anti-hallucination, détection de lead, escalade...)
            sont communes à tous les tenants. L'édition par tenant n'est pas ouverte en V1 —
            une modification impacterait tous les agents simultanément.
          </span>
        </div>
      </section>
    </div>
  );
}