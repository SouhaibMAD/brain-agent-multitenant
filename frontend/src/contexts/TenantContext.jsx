import { createContext, useContext } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
import { useAuth } from "./AuthContext";

const TenantContext = createContext(null);

async function fetchMyTenants() {
  const { data } = await apiClient.get("/tenants/my");
  return data;
}

// Fournit { tenantId, slug, name, role } du tenant actif (résolu depuis :tenantSlug
// dans l'URL) à toute la sous-arborescence. Réutilise la même queryKey que
// TenantSelector (scopée par user.id) — si déjà en cache (venant du sélecteur),
// pas de requête réseau supplémentaire ; sinon TanStack Query la fetch ici.
export function TenantProvider({ children }) {
  const { tenantSlug } = useParams();
  const { user } = useAuth();
  const { data: tenantList, isLoading } = useQuery({
    queryKey: ["my-tenants", user?.id],
    queryFn: fetchMyTenants,
    enabled: !!user,
  });

  if (isLoading) {
    return <div className="full-screen-loader">Chargement…</div>;
  }

  const tenant = tenantList?.find((t) => t.slug === tenantSlug);

  if (!tenant) {
    // slug inconnu ou plus accessible à cet utilisateur — retour au sélecteur
    return <Navigate to="/" replace />;
  }

  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}