import rateLimit from "express-rate-limit";

/**
 * Rate limiting sur /auth/login (CDC §4.3, critère d'acceptation explicite).
 *
 * Fenêtre 15 min, 10 tentatives max par IP — assez large pour un utilisateur
 * légitime qui se trompe de mot de passe plusieurs fois, assez strict pour
 * limiter un brute-force basique. Volontairement PAS appliqué à /register
 * ou /refresh : /register a sa propre protection naturelle (EMAIL_ALREADY_EXISTS),
 * /refresh est appelé automatiquement par l'intercepteur axios (api-client.js)
 * à chaque 401 — un rate limit ici casserait l'UX normale, pas juste les abus.
 *
 * Ne bloque jamais silencieusement : renvoie un code explicite (429 +
 * RATE_LIMITED) plutôt qu'un message générique, cohérent avec le pattern
 * d'erreurs déjà en place partout ailleurs dans le projet.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED" },
  handler: (_req, res) => {
    res.status(429).json({ error: "RATE_LIMITED" });
  },
});