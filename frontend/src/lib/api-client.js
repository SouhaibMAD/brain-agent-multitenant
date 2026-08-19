import axios from "axios";

const BASE_URL = "http://localhost:5000/api";

// L'access token vit en mémoire (variable module), jamais en localStorage :
// cohérent avec le choix httpOnly cookie pour le refresh token — inutile
// d'avoir un stockage persistant pour l'access token, il expire en 15min
// et se régénère de toute façon via le cookie refresh au chargement de l'app.
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // obligatoire : fait partir/revenir le cookie httpOnly refreshToken
});

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// File d'attente des requêtes en échec pendant qu'un refresh est déjà en cours —
// évite une "tempête" de refresh simultanés si plusieurs requêtes 401 arrivent
// en même temps (ex: 3 appels API en parallèle au chargement d'une page).
let isRefreshing = false;
let pendingQueue = [];

function resolveQueue(error, token) {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  pendingQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    const isAuthRoute =
      originalRequest?.url?.includes("/auth/login") ||
      originalRequest?.url?.includes("/auth/refresh");

    if (error.response?.status !== 401 || isAuthRoute || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // un refresh est déjà en vol : on met cette requête en attente de son résultat
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      })
        .then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        })
        .catch((err) => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { data } = await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true }
      );
      setAccessToken(data.accessToken);
      resolveQueue(null, data.accessToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      resolveQueue(refreshError, null);
      setAccessToken(null);
      // le refresh a échoué (cookie expiré/révoqué) : redirection propre vers le login,
      // gérée en dehors de ce fichier via un événement — voir AuthContext.jsx
      window.dispatchEvent(new Event("auth:session-expired"));
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

// Traduction générique des erreurs API en message lisible. Le code d'erreur
// seul (INSUFFICIENT_ROLE) ne dit pas QUOI l'utilisateur essayait de faire —
// chaque appelant fournit un actionLabel pour contextualiser le message.
export function getErrorMessage(error, actionLabel = "cette action") {
  const code = error?.response?.data?.error;
  const status = error?.response?.status;

  if (status === 403 && code === "INSUFFICIENT_ROLE") {
    return `Votre rôle ne permet pas ${actionLabel}. Contactez un administrateur du tenant si vous pensez que c'est une erreur.`;
  }
  if (status === 403) {
    return `Action non autorisée : ${actionLabel} nécessite des permissions supérieures.`;
  }
  if (status === 401) {
    return "Votre session a expiré. Reconnectez-vous.";
  }
  if (status === 404) {
    return "Ressource introuvable.";
  }
  if (status >= 500) {
    return "Erreur serveur. Réessayez dans un instant.";
  }
  return "Une erreur est survenue.";
}