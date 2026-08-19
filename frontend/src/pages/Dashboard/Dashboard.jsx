import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./Dashboard.css";

async function fetchDashboardStats(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/dashboard/stats`);
  return data;
}

function StatCard({ label, value, tone, to }) {
  const content = (
    <div className={`stat-card${tone ? ` stat-card--${tone}` : ""}`}>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="stat-card-link">{content}</Link> : content;
}

function formatResponseTime(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function WhatsappStatusBadge({ whatsapp }) {
  if (!whatsapp.status) {
    return <span className="wa-badge wa-badge--none">Aucune session</span>;
  }
  const labelByStatus = {
    connected: "Connecté",
    pending_qr: "En attente de scan QR",
    logged_out: "Déconnecté",
    stale: "Statut incertain",
  };
  const toneByStatus = {
    connected: "ok",
    pending_qr: "warn",
    logged_out: "alert",
    stale: "warn",
  };
  const label = labelByStatus[whatsapp.status] ?? whatsapp.status;
  const tone = toneByStatus[whatsapp.status] ?? "warn";
  return (
    <span className={`wa-badge wa-badge--${tone}`}>
      {label}
      {whatsapp.phoneNumber ? ` · ${whatsapp.phoneNumber}` : ""}
    </span>
  );
}

export default function Dashboard() {
  const tenant = useTenant();
  const { tenantSlug } = useParams();

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ["dashboard-stats", tenant.tenantId],
    queryFn: () => fetchDashboardStats(tenant.tenantId),
    refetchInterval: 15000, // rafraîchi périodiquement, cohérent avec le polling déjà en place côté WhatsappConnection
  });

  if (isLoading) {
    return <div className="dashboard-page dashboard-loading">Chargement du dashboard…</div>;
  }

  if (isError || !stats) {
    return <div className="dashboard-page dashboard-error">Impossible de charger les statistiques.</div>;
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>Vue d'ensemble</h1>
        <p className="dashboard-subtitle">{tenant.name}</p>
      </header>

      <section className="dashboard-grid">
        <StatCard
          label="Conversations"
          value={stats.conversationsTotal}
          to={`/${tenantSlug}/inbox`}
        />
        <StatCard
          label="En attente humaine"
          value={stats.conversationsHandover}
          tone={stats.conversationsHandover > 0 ? "alert" : undefined}
          to={`/${tenantSlug}/inbox`}
        />
        <StatCard
          label="Leads"
          value={stats.leadsTotal}
          to={`/${tenantSlug}/leads`}
        />
        <StatCard
          label="Leads nouveaux"
          value={stats.leadsNouveau}
          tone={stats.leadsNouveau > 0 ? "info" : undefined}
          to={`/${tenantSlug}/leads`}
        />
        <StatCard
          label="Messages (24h)"
          value={stats.messagesLast24h}
        />
        <StatCard
          label="Temps de réponse moyen"
          value={formatResponseTime(stats.avgResponseTimeSeconds)}
          tone="info"
        />
        <StatCard
          label="Produits au catalogue"
          value={stats.productsTotal}
          to={`/${tenantSlug}/catalog`}
        />
      </section>

      <section className="dashboard-whatsapp">
        <div className="dashboard-whatsapp-row">
          <div>
            <h2>Canal WhatsApp</h2>
            <WhatsappStatusBadge whatsapp={stats.whatsapp} />
          </div>
          <Link to={`/${tenantSlug}/whatsapp`} className="dashboard-whatsapp-link">
            Gérer la connexion →
          </Link>
        </div>
      </section>
    </div>
  );
}