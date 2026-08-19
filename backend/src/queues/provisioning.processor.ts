import { Worker, Job } from "bullmq";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { eq } from "drizzle-orm";
import ws from "ws";
import { connection } from "./redis-connection.js";
import type { ProvisionTenantJobData } from "./provisioning.queue.js";
import { createNeonProjectForTenant } from "../services/neon.service.js";
import { db as controlDb } from "../db/control/index.js";
import { tenants } from "../db/control/schema.js";

// neon-serverless a besoin d'un ws polyfill côté Node (pas requis côté navigateur/edge).
// Sans ça, drizzle-orm/neon-serverless échoue silencieusement à l'ouverture du Pool.
neonConfig.webSocketConstructor = ws;

/**
 * Driver aligné sur neon-serverless (Pool, WebSocket) — cohérent avec la
 * révision déjà actée pour tenant-connection-manager.ts (BLOC 3) : neon-http
 * ne supporte pas de vraies transactions, ce qui laissait le migrator
 * neon-http appliquer les migrations sans garantie atomique par fichier.
 * Un fichier de migration multi-instructions interrompu à mi-chemin
 * (ex: ALTER TABLE réussi, CREATE INDEX suivant en échec) restait à moitié
 * appliqué — un retry rejouait alors le même ALTER TABLE sur une colonne
 * déjà existante, provoquant une boucle d'échec identique à chaque tentative.
 * Ce fichier avait divergé de cette décision (jamais mis à jour depuis BLOC 2/3),
 * cause racine du provisioning bloqué observé en session.
 */
async function processProvisioningJob(job: Job<ProvisionTenantJobData>) {
  const { tenantId, tenantSlug } = job.data;

  const { projectId, connectionUri } = await createNeonProjectForTenant(tenantSlug);

  const pool = new Pool({ connectionString: connectionUri });
  const tenantDb = drizzle(pool);

  try {
    await migrate(tenantDb, {
      migrationsFolder: "./src/db/migrations/tenant",
    });

    await controlDb
      .update(tenants)
      .set({
        databaseUrl: connectionUri,
        neonProjectId: projectId,
        provisioningStatus: "ready",
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    return { tenantId, projectId };
  } catch (err) {
    // Le projet Neon existe déjà à ce stade (créé plus haut) — on le trace
    // quand même en control plane même en cas d'échec de migration, pour
    // qu'un futur nettoyage (dette notée, non traitée) puisse le retrouver
    // au lieu de rester un projet Neon totalement orphelin et introuvable.
    await controlDb
      .update(tenants)
      .set({
        neonProjectId: projectId,
        provisioningStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));

    throw err; // laisse BullMQ gérer le retry/backoff comme avant
  } finally {
    // Ferme explicitement le Pool après chaque migration — sinon accumulation
    // de connexions WebSocket non refermées au fil des jobs traités par ce worker
    // (le worker tourne en continu, contrairement au serveur API qui garde un cache
    // long-lived légitime dans tenant-connection-manager.ts).
    await pool.end();
  }
}

export const provisioningWorker = new Worker<ProvisionTenantJobData>(
  "tenant-provisioning",
  processProvisioningJob,
  { connection }
);

provisioningWorker.on("completed", (job) => {
  console.log(`Provisioning terminé pour le tenant ${job.data.tenantId}`);
});

// Sanitize : err.message peut contenir la connection string complète (avec
// mot de passe DB en clair) si l'échec vient d'une erreur de connexion/driver
// Postgres — jamais logger le message brut sans filtrage (CDC §4.3, logs
// sans secrets).
function sanitizeErrorMessage(message: string): string {
  return message.replace(/postgresql:\/\/[^\s]+/gi, "[CONNECTION_STRING_REDACTED]");
}

provisioningWorker.on("failed", (job, err) => {
  console.error(
    `Provisioning échoué pour le tenant ${job?.data.tenantId}:`,
    sanitizeErrorMessage(err.message)
  );
});