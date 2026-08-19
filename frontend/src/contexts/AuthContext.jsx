import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiClient, setAccessToken } from "../lib/api-client";
import { queryClient } from "../lib/query-client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // "checking" tant qu'on n'a pas tenté la restauration de session au chargement —
  // évite un flash "non connecté" qui redirigerait vers /login avant même d'avoir
  // essayé le cookie refresh existant.
  const [status, setStatus] = useState("checking");

  const login = useCallback(async (email, password) => {
    // Sécurité : vide tout cache résiduel avant d'établir la nouvelle session,
    // au cas où une session précédente (autre utilisateur) aurait laissé des
    // données en cache sans passer par un logout explicite.
    queryClient.clear();
    const { data } = await apiClient.post("/auth/login", { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus("authenticated");
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
      // Vide tout le cache TanStack Query au logout — sans ça, les données du
      // compte précédent (ex: /tenants/my) restent servies depuis le cache
      // si un autre utilisateur se connecte juste après dans le même onglet.
      queryClient.clear();
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await apiClient.patch("/auth/password", { currentPassword, newPassword });
    // Le backend révoque tous les refresh tokens (y compris celui de cette session) —
    // il faut donc déconnecter localement pour rester cohérent, plutôt que de laisser
    // l'utilisateur croire qu'il est encore connecté jusqu'au prochain refresh raté.
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
    queryClient.clear();
  }, []);

  useEffect(() => {
    // Au chargement de l'app : le cookie httpOnly refreshToken existe peut-être déjà
    // (session précédente). On tente un refresh silencieux pour savoir si on est connecté.
    async function tryRestoreSession() {
      try {
        const { data } = await apiClient.post("/auth/refresh");
        setAccessToken(data.accessToken);
        const { data: me } = await apiClient.get("/auth/me");
        setUser(me);
        setStatus("authenticated");
      } catch {
        setStatus("unauthenticated");
      }
    }
    tryRestoreSession();

    function handleSessionExpired() {
      setUser(null);
      setStatus("unauthenticated");
    }
    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => window.removeEventListener("auth:session-expired", handleSessionExpired);
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}