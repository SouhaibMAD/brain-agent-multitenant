import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, getErrorMessage } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./ShopifyConnect.css";

async function fetchStatus(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/shopify/status`);
  return data;
}

async function connectShopify(tenantId, { shopDomain, accessToken }) {
  const { data } = await apiClient.post(`/tenants/${tenantId}/shopify/connect`, {
    shopDomain,
    accessToken,
  });
  return data;
}

async function syncShopify(tenantId) {
  const { data } = await apiClient.post(`/tenants/${tenantId}/shopify/sync`);
  return data;
}

async function disconnectShopify(tenantId) {
  await apiClient.delete(`/tenants/${tenantId}/shopify/connection`);
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ConnectForm({ tenantId, canManageConnection }) {
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const queryClient = useQueryClient();

  const connectMutation = useMutation({
    mutationFn: () => connectShopify(tenantId, { shopDomain, accessToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopify-status", tenantId] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    connectMutation.mutate();
  };

  const isTokenInvalid =
    connectMutation.isError && connectMutation.error?.response?.data?.error === "SHOPIFY_TOKEN_INVALID";

  return (
    <form className="sh-connect-form" onSubmit={handleSubmit}>
      <div className="sh-field">
        <label className="sh-label" htmlFor="sh-shop-domain">
          Domaine de la boutique
        </label>
        <input
          id="sh-shop-domain"
          type="text"
          className="sh-input"
          placeholder="mon-store.myshopify.com"
          value={shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          disabled={!canManageConnection || connectMutation.isPending}
          required
        />
      </div>

      <div className="sh-field">
        <label className="sh-label" htmlFor="sh-access-token">
          Admin API access token
        </label>
        <input
          id="sh-access-token"
          type="password"
          className="sh-input"
          placeholder="shpat_..."
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          disabled={!canManageConnection || connectMutation.isPending}
          required
        />
        <p className="sh-field-hint">
          Généré depuis l'admin Shopify (Settings → Apps and sales channels →
          Develop apps → votre app → API credentials).
        </p>
      </div>

      {connectMutation.isError && (
        <div className="sh-notice sh-notice--error">
          {isTokenInvalid
            ? "Le token ne permet pas de lire les produits — vérifiez le scope read_products et le domaine."
            : getErrorMessage(connectMutation.error, "de connecter Shopify")}
        </div>
      )}

      <button
        type="submit"
        className="sh-connect-btn"
        disabled={!canManageConnection || connectMutation.isPending}
        title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
      >
        {!canManageConnection
          ? "Réservé à l'admin"
          : connectMutation.isPending
          ? "Connexion…"
          : "Connecter Shopify"}
      </button>
    </form>
  );
}

function ConnectedPanel({ tenantId, status, canManageConnection }) {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState(null);

  const syncMutation = useMutation({
    mutationFn: () => syncShopify(tenantId),
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["shopify-status", tenantId] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectShopify(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shopify-status", tenantId] });
    },
  });

  return (
    <div className="sh-connected-panel">
      <div className="sh-connected-header">
        <div className="sh-connected-info">
          <span className="sh-badge sh-badge-connected">Connecté</span>
          <span className="sh-shop-domain">{status.shopDomain}</span>
        </div>
        <div className="sh-connected-actions">
          <button
            type="button"
            className="sh-sync-btn"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !canManageConnection}
            title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
          >
            {!canManageConnection
              ? "Réservé à l'admin"
              : syncMutation.isPending
              ? "Synchronisation…"
              : "Synchroniser maintenant"}
          </button>
          <button
            type="button"
            className="sh-disconnect-btn"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending || !canManageConnection}
            title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
          >
            {disconnectMutation.isPending ? "Déconnexion…" : "Déconnecter"}
          </button>
        </div>
      </div>

      <p className="sh-last-sync">
        Dernière synchronisation : {formatDate(status.lastSyncedAt)}
      </p>

      {disconnectMutation.isError && (
        <div className="sh-notice sh-notice--error">
          {getErrorMessage(disconnectMutation.error, "de déconnecter Shopify")}
        </div>
      )}

      {syncMutation.isError && (
        <div className="sh-notice sh-notice--error">
          {getErrorMessage(syncMutation.error, "de synchroniser le catalogue")}
        </div>
      )}

      {lastResult && (
        <div className="sh-sync-result">
          <div className="sh-sync-stat">
            <span className="sh-sync-stat-value">{lastResult.totalProducts}</span>
            <span className="sh-sync-stat-label">produits Shopify</span>
          </div>
          <div className="sh-sync-stat">
            <span className="sh-sync-stat-value sh-sync-stat-value--created">
              {lastResult.created}
            </span>
            <span className="sh-sync-stat-label">créés</span>
          </div>
          <div className="sh-sync-stat">
            <span className="sh-sync-stat-value">{lastResult.updated}</span>
            <span className="sh-sync-stat-label">mis à jour</span>
          </div>
          {lastResult.skipped > 0 && (
            <div className="sh-sync-stat">
              <span className="sh-sync-stat-value sh-sync-stat-value--error">
                {lastResult.skipped}
              </span>
              <span className="sh-sync-stat-label">ignorés</span>
            </div>
          )}
        </div>
      )}

      {lastResult?.errors?.length > 0 && (
        <div className="sh-errors-list">
          <h3 className="sh-errors-title">Erreurs de synchronisation</h3>
          <ul>
            {lastResult.errors.map((err) => (
              <li key={err.shopifyProductId}>
                Produit {err.shopifyProductId} : {err.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ShopifyConnect() {
  const tenant = useTenant();
  const { tenantId } = tenant;
  const canManageConnection = tenant.role === "admin_tenant";

  const { data: status, isLoading } = useQuery({
    queryKey: ["shopify-status", tenantId],
    queryFn: () => fetchStatus(tenantId),
  });

  if (isLoading) {
    return <div className="sh-shell">Chargement…</div>;
  }

  return (
    <div className="sh-shell">
      <div className="sh-header">
        <h1 className="sh-title">Intégration Shopify</h1>
      </div>

      {!canManageConnection && (
        <div className="sh-notice sh-notice--info">
          Votre rôle vous permet de consulter le statut de connexion, mais seul un
          administrateur du tenant peut connecter Shopify ou déclencher une
          synchronisation.
        </div>
      )}

      {status?.connected ? (
        <ConnectedPanel
          tenantId={tenantId}
          status={status}
          canManageConnection={canManageConnection}
        />
      ) : (
        <ConnectForm tenantId={tenantId} canManageConnection={canManageConnection} />
      )}
    </div>
  );
}