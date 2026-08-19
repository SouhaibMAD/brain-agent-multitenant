import { useState, useEffect } from "react";
import { NavLink, Link, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TenantProvider, useTenant } from "../../contexts/TenantContext";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api-client";
import Inbox from "../../pages/Inbox/Inbox";
import Leads from "../../pages/Leads/Leads";
import WhatsappConnection from "../../pages/Whatsapp/WhatsappConnection";
import ShopifyConnect from "../../pages/Shopify/ShopifyConnect";
import Catalog from "../../pages/Catalog/Catalog";
import Dashboard from "../../pages/Dashboard/Dashboard";
import AgentConfig from "../../pages/AgentConfig/AgentConfig";
import TeamManagement from "../../pages/Team/TeamManagement";
import Profile from "../../pages/Profile/Profile";
import "./AppLayout.css";

const THEME_KEY = "brainagent:theme";

const ROLE_LABEL = {
  admin_tenant: "Admin tenant",
  agent: "Agent",
  viewer: "Lecture seule",
};

async function fetchMyTenants() {
  const { data } = await apiClient.get("/tenants/my");
  return data;
}
async function fetchHandoverCount(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/dashboard/stats`);
  return data.conversationsHandover;
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme];
}

function Sidebar({ theme, onToggleTheme }) {
  const tenant = useTenant();
  const { user, logout } = useAuth();
  const { tenantSlug } = useParams();

  const { data: tenantList } = useQuery({
    queryKey: ["my-tenants", user?.id],
    queryFn: fetchMyTenants,
    enabled: !!user,
  });
  const { data: handoverCount } = useQuery({
    queryKey: ["handover-count", tenant.tenantId],
    queryFn: () => fetchHandoverCount(tenant.tenantId),
    refetchInterval: 5000,
  });

  const hasMultipleTenants = (tenantList?.length ?? 0) > 1;

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-header">
        <div className="app-mark" aria-hidden="true" />
        <div className="app-tenant-name">{tenant.name}</div>
      </div>

      <nav className="app-nav">
        <NavLink to={`/${tenantSlug}/dashboard`} className="app-nav-link">
          Dashboard
        </NavLink>
        <NavLink to={`/${tenantSlug}/inbox?status=handover`} className="app-nav-link app-nav-link--inbox">
          Inbox
          {handoverCount > 0 && (
            <span className="app-nav-badge" aria-label={`${handoverCount} conversation(s) en attente humaine`}>
              {handoverCount}
            </span>
          )}
        </NavLink>
        <NavLink to={`/${tenantSlug}/leads`} className="app-nav-link">
          Leads
        </NavLink>
        <NavLink to={`/${tenantSlug}/catalog`} className="app-nav-link">
          Catalogue
        </NavLink>
        <NavLink to={`/${tenantSlug}/whatsapp`} className="app-nav-link">
          Connexion WhatsApp
        </NavLink>
        <NavLink to={`/${tenantSlug}/shopify`} className="app-nav-link">
          Shopify
        </NavLink>
        <NavLink to={`/${tenantSlug}/agent-config`} className="app-nav-link">
          Configuration agent
        </NavLink>
        <NavLink to={`/${tenantSlug}/team`} className="app-nav-link">
          Équipe
        </NavLink>
        <NavLink to={`/${tenantSlug}/profile`} className="app-nav-link">
          Mon profil
        </NavLink>
        {user?.isSuperAdmin && (
          <NavLink to="/admin/tenants" className="app-nav-link app-nav-link--admin">
            Gestion tenants
          </NavLink>
        )}
      </nav>

      <div className="app-sidebar-footer">
        <button
          type="button"
          className="app-theme-toggle"
          onClick={() => onToggleTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "Mode clair" : "Mode sombre"}
        </button>
        <div className="app-user-row">
          <div className="app-user-identity">
            <span className="app-user-email">{user?.email ?? user?.fullName}</span>
            <span className="app-user-role">{ROLE_LABEL[tenant.role] ?? tenant.role}</span>
          </div>
          <button type="button" className="app-logout" onClick={logout}>
            Déconnexion
          </button>
        </div>
        {hasMultipleTenants && (
          <Link to="/" className="app-switch-tenant">
            Changer d'espace
          </Link>
        )}
      </div>
    </aside>
  );
}

export default function AppLayout() {
  const [theme, setTheme] = useTheme();

  return (
    <TenantProvider>
      <div className="app-shell">
        <Sidebar theme={theme} onToggleTheme={setTheme} />
        <main className="app-content">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="leads" element={<Leads />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="whatsapp" element={<WhatsappConnection />} />
            <Route path="shopify" element={<ShopifyConnect />} />
            <Route path="agent-config" element={<AgentConfig />} />
            <Route path="team" element={<TeamManagement />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </TenantProvider>
  );
}