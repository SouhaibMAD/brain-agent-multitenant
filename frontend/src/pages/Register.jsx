import { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api-client";
import "./Login.css";

export default function Register() {
  const { status } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Même garde que Login : déjà connecté (cookie restauré) → pas de formulaire.
  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiClient.post("/auth/register", {
        fullName: fullName.trim(),
        email: email.trim(),
        password,
      });
      // Décision produit (cohérente avec BLOC 2/6.4) : créer un compte (identité)
      // et donner accès à un tenant (autorisation) sont deux actions distinctes.
      // Après inscription, l'utilisateur n'a encore aucun user_tenant_roles —
      // il doit se connecter, puis attendre une invitation (self-service) ou
      // un bootstrap super_admin. On ne connecte pas automatiquement ici :
      // pas de session à établir tant que l'utilisateur n'a rien confirmé lui-même.
      navigate("/login", {
        replace: true,
        state: { registered: true },
      });
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === "EMAIL_ALREADY_EXISTS") {
        setError("Un compte existe déjà avec cet email.");
      } else {
        setError("Inscription impossible. Réessayez dans un instant.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-mark" aria-hidden="true" />
        <h1 className="login-title">Brain Agent</h1>
        <p className="login-subtitle">Créer un compte</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span>Nom complet</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
              autoFocus
            />
          </label>

          <label className="login-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="login-field">
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={isSubmitting}>
            {isSubmitting ? "Création…" : "Créer mon compte"}
          </button>
        </form>

        <p className="login-switch">
          Déjà un compte ? <Link to="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}