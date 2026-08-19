import { eq, desc, and, inArray } from "drizzle-orm";
import { whatsappSessions } from "../../db/tenant/schema.js";
import { getTenantDb } from "../../db/tenant-connection-manager.js";
import { enqueueWhatsappSessionControl } from "../../queues/whatsapp-session-control.queue.js";
import { connection as redis } from "../../queues/redis-connection.js";
import { db as controlDb } from "../../db/control/index.js";
import { tenants } from "../../db/control/schema.js";
import type { CreateWhatsappSessionResult, WhatsappSessionSummary } from "./whatsapp.types.js";

export async function createWhatsappSession(
  tenantId: string
): Promise<CreateWhatsappSessionResult> {
  const tenantDb = await getTenantDb(tenantId);

  // Neutralise toute ancienne session encore marquée "pending_qr" en DB —
  // son QR Redis (TTL 60s) est de toute façon expiré depuis longtemps si
  // elle traîne encore ici, et sa socket Baileys n'existe plus en mémoire
  // après un ou plusieurs redémarrages du worker. Sans ça, le frontend peut
  // sélectionner cette vieille session comme "active" et afficher un QR mort.
  await tenantDb
    .update(whatsappSessions)
    .set({ connectionStatus: "logged_out", updatedAt: new Date() })
    .where(eq(whatsappSessions.connectionStatus, "pending_qr"));

  const [session] = await tenantDb
    .insert(whatsappSessions)
    .values({})
    .returning({ id: whatsappSessions.id, connectionStatus: whatsappSessions.connectionStatus });

  await enqueueWhatsappSessionControl({
    sessionId: session!.id,
    tenantId,
    action: "start",
  });

  return { sessionId: session!.id, connectionStatus: session!.connectionStatus };
}

export async function getWhatsappSessionQr(
  tenantId: string,
  sessionId: string
): Promise<string | null> {
  const tenantDb = await getTenantDb(tenantId);

  const session = await tenantDb.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.id, sessionId),
  });

  if (!session) {
    throw new Error("WHATSAPP_SESSION_NOT_FOUND");
  }

  const qrDataUrl = await redis.get(`qr:${sessionId}`);
  return qrDataUrl;
}

export async function listWhatsappSessions(
  tenantId: string
): Promise<WhatsappSessionSummary[]> {
  const tenantDb = await getTenantDb(tenantId);

  const sessions = await tenantDb
    .select({
      id: whatsappSessions.id,
      phoneNumber: whatsappSessions.phoneNumber,
      connectionStatus: whatsappSessions.connectionStatus,
      lastConnectedAt: whatsappSessions.lastConnectedAt,
      lastDisconnectReason: whatsappSessions.lastDisconnectReason,
      createdAt: whatsappSessions.createdAt,
    })
    .from(whatsappSessions)
    .orderBy(desc(whatsappSessions.createdAt));

  return sessions;
}

export async function getWhatsappSessionStatus(
  tenantId: string,
  sessionId: string
): Promise<WhatsappSessionSummary> {
  const tenantDb = await getTenantDb(tenantId);

  const session = await tenantDb.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.id, sessionId),
  });

  if (!session) {
    throw new Error("WHATSAPP_SESSION_NOT_FOUND");
  }

  return {
    id: session.id,
    phoneNumber: session.phoneNumber,
    connectionStatus: session.connectionStatus,
    lastConnectedAt: session.lastConnectedAt,
    lastDisconnectReason: session.lastDisconnectReason,
    createdAt: session.createdAt,
  };
}

export async function disconnectWhatsappSession(
  tenantId: string,
  sessionId: string
): Promise<void> {
  const tenantDb = await getTenantDb(tenantId);

  const session = await tenantDb.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.id, sessionId),
  });

  if (!session) {
    throw new Error("WHATSAPP_SESSION_NOT_FOUND");
  }

  await enqueueWhatsappSessionControl({
    sessionId,
    tenantId,
    action: "stop",
  });
}

// ─── Relance d'une session stale ─────────────────────────
//
// Une session "stale" (voir reconcileStaleSessionsOnStartup ci-dessous) a
// des credentials Baileys toujours valides côté control plane — seule la
// socket process a disparu. Relancer revient exactement à ré-exécuter
// "start" sur le même sessionId : startSession() dans session-manager.ts
// va relire les creds existantes via makeControlPlaneAuthState() plutôt que
// d'en générer de nouvelles, donc pas de nouveau QR à scanner si la session
// WhatsApp est toujours active côté téléphone — la reconnexion se fait de
// façon transparente.
//
// N'accepte que "stale" en entrée — une session "connected" n'a pas besoin
// d'être relancée (déjà active), une "logged_out" a ses creds supprimées et
// doit repasser par createWhatsappSession() (nouveau QR), une "pending_qr"
// a déjà un job "start" en cours.
export async function reconnectWhatsappSession(
  tenantId: string,
  sessionId: string
): Promise<void> {
  const tenantDb = await getTenantDb(tenantId);

  const session = await tenantDb.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.id, sessionId),
  });

  if (!session) {
    throw new Error("WHATSAPP_SESSION_NOT_FOUND");
  }

  if (session.connectionStatus !== "stale") {
    throw new Error("SESSION_NOT_STALE");
  }

  await enqueueWhatsappSessionControl({
    sessionId,
    tenantId,
    action: "start",
  });
}

// ─── Réconciliation au démarrage du worker ──────────────
//
// SessionManager.sockets (whatsapp-worker.ts) vit uniquement en mémoire du
// process. Au (re)démarrage, cette Map est vide par construction — donc
// TOUTE session encore marquée "connected" en DB tenant est, par définition,
// fantôme à cet instant précis : le statut DB a survécu au redémarrage, la
// socket réelle non. Sans ce correctif, l'UI affiche "Connecté" alors
// qu'aucun message ne peut plus partir (SESSION_NOT_ACTIVE en boucle côté
// whatsapp-outbound.processor.ts), sans aucun signal pour l'utilisateur.
//
// Statut choisi : "stale", pas "logged_out". Les credentials Baileys
// (control plane) restent valides — ce n'est pas un vrai logout WhatsApp,
// juste une socket process qui n'existe plus. "logged_out" déclencherait à
// tort deleteControlPlaneAuthState() ailleurs dans le code et forcerait un
// nouveau scan QR, alors qu'une simple relance de session suffit ici.
//
// Portée : uniquement les tenants provisioningStatus = "ready" — un tenant
// "pending"/"failed" n'a pas de base tenant exploitable, getTenantDb()
// lèverait TENANT_NOT_PROVISIONED dessus.
export async function reconcileStaleSessionsOnStartup(): Promise<void> {
  const readyTenants = await controlDb
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.provisioningStatus, "ready"));

  let totalReconciled = 0;

  for (const tenant of readyTenants) {
    try {
      const tenantDb = await getTenantDb(tenant.id);

      const result = await tenantDb
        .update(whatsappSessions)
        .set({ connectionStatus: "stale", updatedAt: new Date() })
        .where(eq(whatsappSessions.connectionStatus, "connected"))
        .returning({ id: whatsappSessions.id });

      if (result.length > 0) {
        totalReconciled += result.length;
        console.log(
          `[whatsapp:startup] tenant ${tenant.name} (${tenant.id}) — ${result.length} session(s) "connected" repassée(s) à "stale"`
        );
      }
    } catch (err) {
      // Un tenant individuel en échec (ex: base Neon temporairement
      // injoignable) ne doit pas empêcher la réconciliation des autres, ni
      // bloquer le démarrage du worker.
      console.error(
        `[whatsapp:startup] échec réconciliation tenant ${tenant.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[whatsapp:startup] réconciliation terminée — ${totalReconciled} session(s) fantôme(s) corrigée(s) sur ${readyTenants.length} tenant(s) ready`
  );
}