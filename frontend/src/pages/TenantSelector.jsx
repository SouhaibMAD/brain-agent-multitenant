import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { apiClient } from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";
import "./TenantSelector.css";

const LAST_TENANT_KEY = "brainagent:lastTenantSlug";

async function fetchMyTenants() {
  const { data } = await apiClient.get("/tenants/my");
  return data;
}

export default function TenantSelector() {
  const { user, logout } = useAuth();
  const { data: tenantList, isLoading, isError } = useQuery({
    queryKey: ["my-tenants", user?.id],
    queryFn: fetchMyTenants,
    enabled: !!user,
  });

  if (isLoading) {
    return <div className="full-screen-loader">Chargement des espaces…</div>;
  }

  if (isError) {
    return (
      <div className="tenant-selector-screen">
        <div className="tenant-selector-empty-card">
          <div className="tenant-selector-empty-icon" aria-hidden="true">!</div>
          <h1 className="tenant-selector-empty-title">Impossible de charger vos espaces</h1>
          <p className="tenant-selector-empty-text">
            Une erreur est survenue. Réessayez dans un instant.
          </p>
        </div>
      </div>
    );
  }

  if (!tenantList || tenantList.length === 0) {
    return (
      <div className="tenant-selector-screen">
        <div className="tenant-selector-empty-card">
          <div className="tenant-selector-empty-icon" aria-hidden="true">⋯</div>
          <h1 className="tenant-selector-empty-title">Aucun espace associé</h1>
          <p className="tenant-selector-empty-text">
            Votre compte ({user?.email}) n'a encore accès à aucun tenant.
            Contactez un administrateur pour être invité sur un espace existant.
          </p>
          <button type="button" className="tenant-selector-empty-logout" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  // Un seul tenant accessible : aucun choix réel à faire, on saute directement.
  if (tenantList.length === 1) {
    const only = tenantList[0];
    localStorage.setItem(LAST_TENANT_KEY, only.slug);
    return <Navigate to={`/${only.slug}/dashboard`} replace />;
  }

  // Plusieurs tenants accessibles : toujours afficher le sélecteur. Le dernier
  // choix (localStorage) sert uniquement à pré-sélectionner visuellement,
  // jamais à sauter l'écran — sauter silencieusement empêcherait de changer
  // de tenant une fois qu'un deuxième devient accessible (bug réel observé :
  // un compte avec 1 seul tenant au premier login restait bloqué dessus même
  // après avoir reçu un rôle sur un second tenant).
  const lastSlug = localStorage.getItem(LAST_TENANT_KEY);

  function handleSelect(slug) {
    localStorage.setItem(LAST_TENANT_KEY, slug);
  }

  return (
    <div className="tenant-selector-screen">
      <div className="tenant-selector-card">
        <h1 className="tenant-selector-title">Choisir un espace</h1>
        <ul className="tenant-selector-list">
          {tenantList.map((t) => (
            <li key={t.tenantId}>
              <Link
                to={`/${t.slug}/dashboard`}
                className={`tenant-selector-item${t.slug === lastSlug ? " tenant-selector-item--last" : ""}`}
                onClick={() => handleSelect(t.slug)}
              >
                <span className="tenant-selector-name">{t.name}</span>
                <span className="tenant-selector-role">{t.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}