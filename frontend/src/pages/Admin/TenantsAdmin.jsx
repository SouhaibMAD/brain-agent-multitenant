import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client";
import { useAuth } from "../../contexts/AuthContext";
import "./TenantsAdmin.css";

async function fetchTenants() {
  const { data } = await apiClient.get("/tenants");
  return data;
}

async function createTenant(input) {
  const { data } = await apiClient.post("/tenants", input);
  return data;
}

async function deactivateTenant(tenantId) {
  const { data } = await apiClient.patch(`/tenants/${tenantId}/deactivate`);
  return data;
}

const STATUS_LABEL = {
  pending: "Provisioning en cours",
  ready: "Prêt",
  failed: "Échec provisioning",
};

const STATUS_TONE = {
  pending: "warn",
  ready: "ok",
  failed: "alert",
};

function CreateTenantForm({ onCreated }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState(null);

  const mutation = useMutation({
    mutationFn: createTenant,
    onSuccess: () => {
      setName("");
      setSlug("");
      setError(null);
      onCreated();
    },
    onError: (err) => {
      const code = err?.response?.data?.error;
      setError(code === "SLUG_ALREADY_EXISTS" ? "Ce slug est déjà utilisé." : "Erreur lors de la création.");
    },
  });

  function handleSlugChange(value) {
    // Normalisation légère côté UI — le slug doit rester technique (pas
    // d'espaces/accents), la validation d'unicité réelle reste côté backend.
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    mutation.mutate({ name: name.trim(), slug: slug.trim() });
  }

  return (
    <form className="tenant-create-form" onSubmit={handleSubmit}>
      <div className="tenant-create-field">
        <label htmlFor="tenant-name">Nom commercial</label>
        <input
          id="tenant-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Boutique Salma"
          required
        />
      </div>
      <div className="tenant-create-field">
        <label htmlFor="tenant-slug">Slug</label>
        <input
          id="tenant-slug"
          type="text"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="ex: boutique-salma"
          required
        />
      </div>
      {error && <div className="tenant-create-error">{error}</div>}
      <button type="submit" className="tenant-create-submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Création…" : "Créer le tenant"}
      </button>
    </form>
  );
}

function TenantRow({ tenant, onDeactivate, isDeactivating }) {
  const tone = STATUS_TONE[tenant.provisioningStatus] ?? "warn";
  const label = STATUS_LABEL[tenant.provisioningStatus] ?? tenant.provisioningStatus;

  return (
    <tr className={!tenant.isActive ? "tenant-row--inactive" : undefined}>
      <td>{tenant.name}</td>
      <td className="tenant-row-slug">{tenant.slug}</td>
      <td>
        <span className={`tenant-status tenant-status--${tone}`}>{label}</span>
      </td>
      <td>{tenant.isActive ? "Actif" : "Désactivé"}</td>
      <td className="tenant-row-actions">
        <Link to={`/admin/tenants/${tenant.id}/users`} className="tenant-users-link">
          Utilisateurs
        </Link>
        {tenant.isActive && (
          <button
            type="button"
            className="tenant-deactivate-btn"
            onClick={() => onDeactivate(tenant.id)}
            disabled={isDeactivating}
          >
            Désactiver
          </button>
        )}
      </td>
    </tr>
  );
}

export default function TenantsAdmin() {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const [pendingDeactivateId, setPendingDeactivateId] = useState(null);

  const { data: tenants, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: fetchTenants,
    enabled: status === "authenticated" && !!user?.isSuperAdmin,
    refetchInterval: 5000, // provisioning peut changer d'état en arrière-plan
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateTenant,
    onMutate: (tenantId) => setPendingDeactivateId(tenantId),
    onSettled: () => setPendingDeactivateId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-tenants"] }),
  });

  if (status === "checking") {
    return <div className="full-screen-loader">Chargement…</div>;
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!user?.isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="tenants-admin-page">
      <header className="tenants-admin-header">
        <div>
          <h1>Gestion des tenants</h1>
          <p className="tenants-admin-subtitle">Plateforme — vue super admin</p>
        </div>
        <Link to="/" className="tenants-admin-back">
          ← Retour à mes tenants
        </Link>
      </header>

      <section className="tenants-admin-create">
        <h2>Nouveau tenant</h2>
        <CreateTenantForm
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["admin-tenants"] })}
        />
      </section>

      <section className="tenants-admin-list">
        <div className="tenants-admin-list-header">
          <h2>Tenants existants</h2>
          <button
            type="button"
            className="tenants-refresh-btn"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Actualisation…" : "Actualiser"}
          </button>
        </div>
        {isLoading ? (
          <div className="tenants-admin-loading">Chargement…</div>
        ) : (
          <table className="tenants-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Slug</th>
                <th>Provisioning</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants?.map((tenant) => (
                <TenantRow
                  key={tenant.id}
                  tenant={tenant}
                  onDeactivate={(id) => deactivateMutation.mutate(id)}
                  isDeactivating={pendingDeactivateId === tenant.id}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}