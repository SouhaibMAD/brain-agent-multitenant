// src/modules/dashboard/dashboard.service.ts
import { sql as rawSql } from "drizzle-orm";
import { getTenantDb } from "../../db/tenant-connection-manager.js";
import type { DashboardStats } from "./dashboard.types.js";

/**
 * Agrégats légers pour le dashboard tenant (BLOC 7.1). Une seule requête
 * multi-CTE plutôt que plusieurs allers-retours séparés — évite de payer
 * 5-6 round-trips réseau vers Neon juste pour des COUNT(*), cohérent avec
 * la philosophie déjà en place (une requête bien construite plutôt que N
 * requêtes naïves, voir catalog.service.ts BLOC 4).
 *
 * whatsapp_sessions n'a pas de FK directe vers un tenant (multi-session
 * par tenant déjà anticipé côté schéma, BLOC 2) — la session la plus
 * récente (par updatedAt) est utilisée comme statut affiché, cohérent
 * avec l'hypothèse déjà faite côté UI WhatsappConnection (BLOC 7.3) que
 * la V1 ne gère qu'une session active à la fois en pratique.
 *
 * Temps de réponse moyen (BLOC 9) : pour chaque message 'outbound', delta
 * avec le message immédiatement précédent de la même conversation via
 * LAG() en window function — seulement retenu si ce précédent est bien
 * 'inbound' (sinon on mesurerait le delta entre deux messages outbound
 * consécutifs de l'agent, ce qui n'a pas de sens métier). Fenêtré sur les
 * dernières 24h, cohérent avec messagesLast24h déjà existant. Délais >
 * 5 min exclus — typiquement une reprise après handover humain ou un
 * message humain envoyé bien plus tard dans le thread, pas représentatif
 * de la latence réelle de l'agent IA.
 */
export async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  const tenantDb = await getTenantDb(tenantId);

  const result = await tenantDb.execute(rawSql`
    WITH response_pairs AS (
      SELECT
        direction,
        sent_at,
        LAG(direction) OVER (PARTITION BY conversation_id ORDER BY sent_at) AS prev_direction,
        LAG(sent_at) OVER (PARTITION BY conversation_id ORDER BY sent_at) AS prev_sent_at
      FROM messages
      WHERE sent_at >= NOW() - INTERVAL '24 hours'
    ),
    response_deltas AS (
      SELECT EXTRACT(EPOCH FROM (sent_at - prev_sent_at)) AS delta_seconds
      FROM response_pairs
      WHERE direction = 'outbound'
        AND prev_direction = 'inbound'
        AND sent_at - prev_sent_at <= INTERVAL '5 minutes'
    )
    SELECT
      (SELECT COUNT(*) FROM conversations) AS "conversationsTotal",
      (SELECT COUNT(*) FROM conversations WHERE status = 'handover') AS "conversationsHandover",
      (SELECT COUNT(*) FROM leads) AS "leadsTotal",
      (SELECT COUNT(*) FROM leads WHERE lead_status = 'nouveau') AS "leadsNouveau",
      (SELECT COUNT(*) FROM messages WHERE sent_at >= NOW() - INTERVAL '24 hours') AS "messagesLast24h",
      (SELECT COUNT(*) FROM products) AS "productsTotal",
      (SELECT connection_status FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 1) AS "waStatus",
      (SELECT phone_number FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 1) AS "waPhoneNumber",
      (SELECT AVG(delta_seconds) FROM response_deltas) AS "avgResponseTimeSeconds"
  `);

  const row = result.rows[0] as Record<string, unknown>;

  const avgResponseTimeRaw = row.avgResponseTimeSeconds;
  const avgResponseTimeSeconds =
    avgResponseTimeRaw !== null && avgResponseTimeRaw !== undefined
      ? Math.round(Number(avgResponseTimeRaw) * 10) / 10
      : null;

  return {
    conversationsTotal: Number(row.conversationsTotal ?? 0),
    conversationsHandover: Number(row.conversationsHandover ?? 0),
    leadsTotal: Number(row.leadsTotal ?? 0),
    leadsNouveau: Number(row.leadsNouveau ?? 0),
    messagesLast24h: Number(row.messagesLast24h ?? 0),
    productsTotal: Number(row.productsTotal ?? 0),
    avgResponseTimeSeconds,
    whatsapp: {
      connected: row.waStatus === "connected",
      status: (row.waStatus as string | null) ?? null,
      phoneNumber: (row.waPhoneNumber as string | null) ?? null,
    },
  };
}