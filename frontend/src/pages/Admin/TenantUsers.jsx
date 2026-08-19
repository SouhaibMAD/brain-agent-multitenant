import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Link, useParams } from "react-router-dom";
import { apiClient, getErrorMessage } from "../../lib/api-client";
import { useAuth } from "../../contexts/AuthContext";
import "./TenantUsers.css";

async function fetchTenant(tenantId) {
  const { data } = await apiClient.get("/tenants");
  return data.find((t) => t.id === tenantId);
}

async function fetchRoles(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/roles`);
  return data;
}

async function lookupUser(email) {
  const { data } = await apiClient.get("/tenants/users/lookup", {
    params: { email },
  });
  return data;
}

async function assignRole({ tenantId, userId, role }) {
  const { data } = await apiClient.post(`/tenants/${tenantId}/roles`, { userId, role });
  return data;
}

async function updateRole({ tenantId, userId, role }) {
  const { data } = await apiClient.patch(`/tenants/${tenantId}/roles/${userId}`, { role });
  return data;
}

const ROLE_LABEL = {
  admin_tenant: "Admin tenant",
  agent: "Agent",
  viewer: "Lecture seule",
};

const ASSIGNABLE_ROLES = ["admin_tenant", "agent", "viewer"];

const ERROR_LABEL = {
  USER_NOT_FOUND: "Aucun compte trouvé pour cet email. L'utilisateur doit d'abord s'inscrire.",
  USER_ALREADY_HAS_ROLE_ON_TENANT: "Cet utilisateur a déjà un rôle sur ce tenant — modifiez-le directement dans la liste ci-dessous.",
  ROLE_LINK_NOT_FOUND: "Ce lien utilisateur↔tenant n'existe plus.",
};

function AssignUserForm({ tenantId, onAssigned }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [foundUser, setFoundUser] = useState(null);
  const [error, setError] = useState(null);

  const lookupMutation = useMutation({
    mutationFn: lookupUser,
    onSuccess: (user) => {
      setFoundUser(user);
      setError(null);
    },
    onError: (err) => {
      setFoundUser(null);
      const code = err?.response?.data?.error;
      setError(ERROR_LABEL[code] ?? "Erreur lors de la recherche.");
    },
  });

  const assignMutation = useMutation({
    mutationFn: assignRole,
    onSuccess: () => {
      setEmail("");
      setFoundUser(null);
      setRole("agent");
      setError(null);
      onAssigned();
    },
    onError: (err) => {
      const code = err?.response?.data?.error;
      setError(ERROR_LABEL[code] ?? "Erreur lors de l'assignation.");
    },
  });

  function handleLookup(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setFoundUser(null);
    lookupMutation.mutate(email.trim());
  }

  function handleAssign(e) {
    e.preventDefault();
    if (!foundUser) return;
    assignMutation.mutate({ tenantId, userId: foundUser.id, role });
  }

  return (
    <div className="tenant-users-assign">
      <form className="tenant-users-lookup-form" onSubmit={handleLookup}>
        <div className="tenant-users-field">
          <label htmlFor="lookup-email">Email de l'utilisateur</label>
          <input
            id="lookup-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFoundUser(null);
            }}
            placeholder="utilisateur@exemple.com"
            required
          />
        </div>
        <button type="submit" className="tenant-users-lookup-btn" disabled={lookupMutation.isPending}>
          {lookupMutation.isPending ? "Recherche…" : "Chercher"}
        </button>
      </form>

      {error && <div className="tenant-users-error">{error}</div>}

      {foundUser && (
        <form className="tenant-users-confirm-form" onSubmit={handleAssign}>
          <div className="tenant-users-found">
            Trouvé : <strong>{foundUser.fullName}</strong> ({foundUser.email})
            {foundUser.isSuperAdmin && <span className="tenant-users-badge-sa">super admin</span>}
          </div>
          <div className="tenant-users-field">
            <label htmlFor="assign-role">Rôle</label>
            <select id="assign-role" value={role} onChange={(e) => setRole(e.target.value)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tenant-users-assign-btn" disabled={assignMutation.isPending}>
            {assignMutation.isPending ? "Assignation…" : "Assigner ce rôle"}
          </button>
        </form>
      )}
    </div>
  );
}

function UserRoleRow({ link, tenantId, onUpdated }) {
  const [isEditing, setIsEditing] = useState(false);
  const [role, setRole] = useState(link.role);
  const [error, setError] = useState(null);

  const updateMutation = useMutation({
    mutationFn: updateRole,
    onSuccess: () => {
      setIsEditing(false);
      setError(null);
      onUpdated();
    },
    onError: (err) => {
      const code = err?.response?.data?.error;
      setError(ERROR_LABEL[code] ?? "Erreur lors de la modification.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => apiClient.delete(`/tenants/${tenantId}/roles/${link.userId}`),
    onSuccess: onUpdated,
    onError: (err) => setError(getErrorMessage(err, "de retirer cet utilisateur")),
  });

  function handleRemove() {
    if (!window.confirm(`Retirer ${link.email} de ce tenant ?`)) return;
    removeMutation.mutate();
  }
  function handleSave() {
    if (role === link.role) {
      setIsEditing(false);
      return;
    }
    updateMutation.mutate({ tenantId, userId: link.userId, role });
  }

  function handleCancel() {
    setRole(link.role);
    setIsEditing(false);
    setError(null);
  }

  return (
    <tr>
      <td>
        <div className="tenant-users-row-identity">
          <span className="tenant-users-row-email">{link.email}</span>
          <span className="tenant-users-row-name">{link.fullName}</span>
        </div>
      </td>
      <td>
        {isEditing ? (
          <select value={role} onChange={(e) => setRole(e.target.value)} className="tenant-users-row-select">
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABEL[link.role] ?? link.role
        )}
      </td>
      <td className="tenant-users-row-actions">
        {isEditing ? (
          <>
            <button
              type="button"
              className="tenant-users-row-save"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "…" : "Enregistrer"}
            </button>
            <button type="button" className="tenant-users-row-cancel" onClick={handleCancel}>
              Annuler
            </button>
          </>
        ) : (
          <>
            <button type="button" className="tenant-users-row-edit" onClick={() => setIsEditing(true)}>
              Modifier
            </button>
            <button
              type="button"
              className="tenant-users-row-remove"
              onClick={handleRemove}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "…" : "Retirer"}
            </button>
          </>
        )}
        {error && <div className="tenant-users-row-error">{error}</div>}
      </td>
    </tr>
  );
}

export default function TenantUsers() {
  const { user, status } = useAuth();
  const { tenantId } = useParams();
  const queryClient = useQueryClient();

  const { data: tenant } = useQuery({
    queryKey: ["admin-tenant-single", tenantId],
    queryFn: () => fetchTenant(tenantId),
    enabled: status === "authenticated" && !!user?.isSuperAdmin,
  });

  const { data: roles, isLoading } = useQuery({
    queryKey: ["tenant-roles", tenantId],
    queryFn: () => fetchRoles(tenantId),
    enabled: status === "authenticated" && !!user?.isSuperAdmin,
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tenant-roles", tenantId] });

  return (
    <div className="tenant-users-page">
      <header className="tenant-users-header">
        <div>
          <h1>Utilisateurs — {tenant?.name ?? "…"}</h1>
          <p className="tenant-users-subtitle">Assignation de rôles (bootstrap plateforme)</p>
        </div>
        <Link to="/admin/tenants" className="tenant-users-back">
          ← Retour aux tenants
        </Link>
      </header>

      <section className="tenant-users-assign-section">
        <h2>Assigner un utilisateur</h2>
        <AssignUserForm tenantId={tenantId} onAssigned={invalidate} />
      </section>

      <section className="tenant-users-list-section">
        <h2>Utilisateurs assignés</h2>
        {isLoading ? (
          <div className="tenant-users-loading">Chargement…</div>
        ) : roles?.length === 0 ? (
          <div className="tenant-users-empty">Aucun utilisateur assigné à ce tenant pour l'instant.</div>
        ) : (
          <table className="tenant-users-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles?.map((link) => (
                <UserRoleRow key={link.id} link={link} tenantId={tenantId} onUpdated={invalidate} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}