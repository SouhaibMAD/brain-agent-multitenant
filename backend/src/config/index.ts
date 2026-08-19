import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// Toutes les variables critiques sont validées ICI, une seule fois, au chargement
// du module — donc au tout premier import de `config`, avant que le serveur
// n'accepte une seule requête. Un secret manquant fait planter le process
// immédiatement au démarrage (`npm run dev` échoue tout de suite), plutôt que
// silencieusement au premier appel réel (ex: JWT_ACCESS_SECRET absent ne devait
// plus planter seulement au premier login).
export const config = {
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  port: Number(optionalEnv("PORT", "5000")),

  databaseUrl: requireEnv("DATABASE_URL"),
  tenantTemplateDatabaseUrl: requireEnv("TENANT_TEMPLATE_DATABASE_URL"),

  jwt: {
    accessSecret: requireEnv("JWT_ACCESS_SECRET"),
    refreshSecret: requireEnv("JWT_REFRESH_SECRET"),
    accessExpiresIn: optionalEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
    refreshExpiresIn: optionalEnv("JWT_REFRESH_EXPIRES_IN", "7d"),
  },

  neonApiKey: requireEnv("NEON_API_KEY"),
  redisUrl: requireEnv("REDIS_URL"),
  groqApiKey: requireEnv("GROQ_API_KEY"),
  shopifyWebhookSecret: requireEnv('SHOPIFY_WEBHOOK_SECRET'),

  corsAllowedOrigins: optionalEnv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(","),
} as const;