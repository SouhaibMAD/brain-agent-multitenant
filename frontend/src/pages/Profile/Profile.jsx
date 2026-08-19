import { useTenant } from "../../contexts/TenantContext";
import { useAuth } from "../../contexts/AuthContext";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Profile.css";

const ROLE_LABEL = {
  admin_tenant: "Admin tenant",
  agent: "Agent",
  viewer: "Lecture seule",
};

const ROLE_TONE = {
  admin_tenant: "info",
  agent: "ok",
  viewer: "warn",
};

// Matrice de permissions — source de vérité manuelle, doit rester alignée
// avec les gardes réelles côté backend (requireMinimumRole sur chaque route,
// voir conversations/products/whatsapp.routes.ts). Toute modification de
// permission backend doit être répercutée ici.
const PERMISSIONS = [
  {
    label: "Consulter l'inbox et lire les messages",
    roles: ["admin_tenant", "agent", "viewer"],
  },
  {
    label: "Répondre manuellement aux clients / gérer le bot",
    roles: ["admin_tenant", "agent"],
  },
  {
    label: "Importer le catalogue produit (CSV/JSON)",
    roles: ["admin_tenant", "agent"],
  },
  {
    label: "Connecter / déconnecter une session WhatsApp",
    roles: ["admin_tenant"],
  },
  {
    label: "Inviter des collaborateurs (agent, viewer)",
    roles: ["admin_tenant"],
  },
  {
    label: "Modifier ou retirer un rôle existant",
    roles: [], // réservé au bootstrap super_admin, aucun rôle tenant ne l'a
  },
];

function ChangePasswordForm() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ERROR_LABEL = {
    INVALID_CURRENT_PASSWORD: "Mot de passe actuel incorrect.",
    PASSWORD_TOO_SHORT: "Le nouveau mot de passe doit faire au moins 8 caractères.",
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      // La session est révoquée côté serveur — retour au login, cohérent
      // avec le comportement attendu après un changement de mot de passe.
      navigate("/login", { replace: true });
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(ERROR_LABEL[code] ?? "Erreur lors du changement de mot de passe.");
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="profile-password-toggle" onClick={() => setIsOpen(true)}>
        Modifier mon mot de passe
      </button>
    );
  }

  return (
    <form className="profile-password-form" onSubmit={handleSubmit}>
      <div className="profile-password-field">
        <label htmlFor="current-password">Mot de passe actuel</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      <div className="profile-password-field">
        <label htmlFor="new-password">Nouveau mot de passe</label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>
      <div className="profile-password-field">
        <label htmlFor="confirm-password">Confirmer le nouveau mot de passe</label>
        <input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          required
        />
      </div>

      {error && <div className="profile-password-error">{error}</div>}

      <p className="profile-password-note">
        Vous serez déconnecté après ce changement, pour votre sécurité.
      </p>

      <div className="profile-password-actions">
        <button type="submit" className="profile-password-submit" disabled={isSubmitting}>
          {isSubmitting ? "Modification…" : "Confirmer"}
        </button>
        <button
          type="button"
          className="profile-password-cancel"
          onClick={() => {
            setIsOpen(false);
            setError(null);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

export default function Profile() {
  const tenant = useTenant();
  const { user } = useAuth();

  return (
    <div className="profile-page">
      <header className="profile-header">
        <h1>Mon profil</h1>
        <p className="profile-subtitle">{tenant.name}</p>
      </header>

      <section className="profile-identity-card">
        <div className="profile-identity-row">
          <span className="profile-identity-label">Nom complet</span>
          <span className="profile-identity-value">{user?.fullName}</span>
        </div>
        <div className="profile-identity-row">
          <span className="profile-identity-label">Email</span>
          <span className="profile-identity-value">{user?.email}</span>
        </div>
        {user?.isSuperAdmin && (
          <div className="profile-super-admin-badge">Super Admin Plateforme</div>
        )}
      </section>

      <section className="profile-permissions-card">
        <div className="profile-role-banner">
          <span className="profile-role-banner-label">Rôle sur ce tenant</span>
          <span className={`profile-role-badge profile-role-badge--${ROLE_TONE[tenant.role] ?? "warn"}`}>
            {ROLE_LABEL[tenant.role] ?? tenant.role}
          </span>
        </div>

        <ul className="profile-permissions-list">
          {PERMISSIONS.map((perm) => {
            const allowed = perm.roles.includes(tenant.role);
            return (
              <li key={perm.label} className="profile-permission-item">
                <span className={`profile-permission-icon${allowed ? " allowed" : " denied"}`}>
                  {allowed ? "✓" : "✕"}
                </span>
                <span className={allowed ? "" : "profile-permission-text-denied"}>
                  {perm.label}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="profile-permissions-note">
          Ces permissions sont appliquées côté serveur — cette page reflète les règles
          réelles, elle ne les définit pas.
        </p>
      </section>
      <section className="profile-security-card">
        <h2>Sécurité du compte</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}