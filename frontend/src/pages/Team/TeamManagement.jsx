import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./TeamManagement.css";

async function fetchRoles(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/roles`);
  return data;
}

async function inviteUser({ tenantId, email, role }) {
  const { data } = await apiClient.post(`/tenants/${tenantId}/invite`, { email, role });
  return data;
}

const ROLE_LABEL = {
  admin_tenant: "Admin tenant",
  agent: "Agent",
  viewer: "Lecture seule",
};

const SELF_SERVICE_ROLES = ["agent", "viewer"];

const ERROR_LABEL = {
  USER_NOT_FOUND: "Aucun compte trouvé pour cet email. La personne doit d'abord s'inscrire sur la plateforme.",
  USER_ALREADY_HAS_ROLE_ON_TENANT: "Cette personne fait déjà partie de l'équipe.",
  INVALID_ROLE_MUST_BE_AGENT_OR_VIEWER: "Rôle invalide.",
};

function InviteForm({ tenantId, onInvited }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [error, setError] = useState(null);

  const mutation = useMutation({
    mutationFn: inviteUser,
    onSuccess: () => {
      setEmail("");
      setRole("agent");
      setError(null);
      onInvited();
    },
    onError: (err) => {
      const code = err?.response?.data?.error;
      setError(ERROR_LABEL[code] ?? "Erreur lors de l'invitation.");
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate({ tenantId, email: email.trim(), role });
  }

  return (
    <form className="team-invite-form" onSubmit={handleSubmit}>
      <div className="team-field">
        <label htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="collegue@exemple.com"
          required
        />
      </div>
      <div className="team-field">
        <label htmlFor="invite-role">Rôle</label>
        <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {SELF_SERVICE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="team-error">{error}</div>}
      <button type="submit" className="team-invite-submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Invitation…" : "Inviter"}
      </button>
    </form>
  );
}

export default function TeamManagement() {
  const tenant = useTenant();
  const queryClient = useQueryClient();

  const { data: roles, isLoading } = useQuery({
    queryKey: ["tenant-roles", tenant.tenantId],
    queryFn: () => fetchRoles(tenant.tenantId),
  });

  const isAdminTenant = tenant.role === "admin_tenant";

  if (!isAdminTenant) {
    return (
      <div className="team-page">
        <div className="team-restricted">
          Cette section est réservée aux administrateurs du tenant.
        </div>
      </div>
    );
  }

  return (
    <div className="team-page">
      <header className="team-header">
        <h1>Équipe</h1>
        <p className="team-subtitle">{tenant.name}</p>
      </header>

      <section className="team-invite-section">
        <h2>Inviter un membre</h2>
        <p className="team-invite-hint">
          Rôles disponibles en self-service : Agent, Lecture seule. Pour un rôle Admin tenant,
          contactez un super administrateur de la plateforme.
        </p>
        <InviteForm
          tenantId={tenant.tenantId}
          onInvited={() => queryClient.invalidateQueries({ queryKey: ["tenant-roles", tenant.tenantId] })}
        />
      </section>

      <section className="team-list-section">
        <h2>Membres de l'équipe</h2>
        {isLoading ? (
          <div className="team-loading">Chargement…</div>
        ) : roles?.length === 0 ? (
          <div className="team-empty">Aucun membre pour l'instant.</div>
        ) : (
          <table className="team-table">
            <thead>
              <tr>
                <th>Membre</th>
                <th>Rôle</th>
              </tr>
            </thead>
            <tbody>
              {roles?.map((link) => (
                <tr key={link.id}>
                  <td>
                    <div className="team-row-identity">
                      <div className="team-row-avatar" aria-hidden="true">
                        {link.fullName?.charAt(0).toUpperCase() ?? link.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="team-row-identity-text">
                        <span className="team-row-name">{link.fullName}</span>
                        <span className="team-row-email">{link.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{ROLE_LABEL[link.role] ?? link.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}