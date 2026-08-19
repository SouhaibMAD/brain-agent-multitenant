import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { config } from "../../config/index.js";
import * as schema from "./schema.js";

// Utilise désormais config.databaseUrl (déjà validé par requireEnv au chargement
// de config/index.ts) au lieu de relire process.env.DATABASE_URL! directement —
// une seule source de vérité pour cette variable dans tout le projet.
const sql = neon(config.databaseUrl);

export const db = drizzle(sql, { schema });