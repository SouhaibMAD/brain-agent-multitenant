import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  downloadMediaMessage,
} from "baileys";
import type { WASocket } from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { connection as redis } from "../../queues/redis-connection.js";
import { makeControlPlaneAuthState, deleteControlPlaneAuthState } from "./whatsapp-auth-state.js";
import { enqueueWhatsappStatus } from "../../queues/whatsapp-status.queue.js";
import { enqueueWhatsappInbound } from "../../queues/whatsapp-inbound.queue.js";
import { compressImageToLimit } from "./image-compression.js";


const RECONNECT_DELAY_MS = 5000;
const QR_TTL_SECONDS = 60;

const logger = pino({ level: "silent" });

class SessionManager {
  private sockets = new Map<string, WASocket>();
  private loggedOutSessions = new Set<string>();

  // Sessions actuellement en fermeture transitoire (code != loggedOut),
  // entre le "connection: close" et la reconnexion automatique (voir
  // RECONNECT_DELAY_MS). Distinct de loggedOutSessions : ici, la session
  // reste valable, elle est juste temporairement indisponible.
  //
  // Contexte (bug réel observé en test) : avant ce changement, le socket
  // était retiré de `sockets` dès la fermeture, AVANT même de savoir si la
  // reconnexion (5s plus tard) allait réussir. Pendant ce trou,
  // getSocket() renvoyait undefined — indiscernable côté appelant d'une
  // session réellement morte. Un envoi manuel (ou agent) tombant dans
  // cette fenêtre échouait en SESSION_NOT_ACTIVE, avec un risque
  // d'épuisement des retries BullMQ si la fenêtre de retry ne couvrait
  // pas RECONNECT_DELAY_MS + le temps de connexion réel (voir
  // whatsapp-outbound.processor.ts / .queue.ts, corrigés en parallèle).
  private reconnectingSessions = new Set<string>();

  getSocket(sessionId: string): WASocket | undefined {
    return this.sockets.get(sessionId);
  }

  isLoggedOut(sessionId: string): boolean {
    return this.loggedOutSessions.has(sessionId);
  }

  // Utilisé par le processor outbound pour distinguer "session en cours de
  // reconnexion transitoire, réessaie" de "session vraiment absente/jamais
  // démarrée" — les deux cas donnent getSocket() === undefined, mais
  // seul le premier justifie un retry patient plutôt qu'un échec rapide.
  isReconnecting(sessionId: string): boolean {
    return this.reconnectingSessions.has(sessionId);
  }

  async startSession(sessionId: string, tenantId: string): Promise<void> {
    this.loggedOutSessions.delete(sessionId);

    const { state, saveCreds } = await makeControlPlaneAuthState(sessionId, tenantId);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sockets.set(sessionId, sock);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrImage = await QRCode.toDataURL(qr);
        await redis.set(`qr:${sessionId}`, qrImage, "EX", QR_TTL_SECONDS);
        await enqueueWhatsappStatus({ sessionId, tenantId, connectionStatus: "pending_qr" });
      }

      if (connection === "open") {
        // Reconnexion réussie (ou première connexion) — la session n'est
        // plus "en cours de reconnexion", quelle que soit la raison de la
        // fermeture précédente.
        this.reconnectingSessions.delete(sessionId);

        const phoneNumber = sock.user?.id?.split(":")[0];
        await enqueueWhatsappStatus(
          phoneNumber
            ? { sessionId, tenantId, connectionStatus: "connected", phoneNumber }
            : { sessionId, tenantId, connectionStatus: "connected" }
        );
      }

      if (connection === "close") {
        if (this.loggedOutSessions.has(sessionId)) {
          // Stop explicite déjà en cours (stopSession) — comportement
          // inchangé, socket retiré immédiatement, pas de reconnexion.
          this.sockets.delete(sessionId);
          this.reconnectingSessions.delete(sessionId);
          console.log(`[whatsapp:${sessionId}] fermeture après stop explicite — pas de reconnexion`);
          await enqueueWhatsappStatus({ sessionId, tenantId, connectionStatus: "logged_out" });
          return;
        }

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          // Vrai logout WhatsApp — comportement inchangé, socket retiré
          // définitivement, creds supprimées, pas de reconnexion.
          this.sockets.delete(sessionId);
          this.reconnectingSessions.delete(sessionId);
          console.log(`[whatsapp:${sessionId}] logout explicite — creds supprimées, pas de reconnexion`);
          this.loggedOutSessions.add(sessionId);
          await deleteControlPlaneAuthState(sessionId);
          await enqueueWhatsappStatus({ sessionId, tenantId, connectionStatus: "logged_out" });
          return;
        }

        // Fermeture transitoire (ex: code 515, coupure réseau...) — la
        // session reste valable et va se reconnecter automatiquement.
        // CHANGEMENT : on ne retire plus le socket de `sockets`
        // immédiatement. Il est désormais fermé (inutilisable pour
        // sendMessage) mais reste présent le temps de la reconnexion —
        // getSocket() continuerait sinon à renvoyer un socket mort le
        // temps que isReconnecting() soit consulté. On le retire quand
        // même ici (un socket fermé ne doit jamais servir à sendMessage),
        // mais on marque explicitement la session comme "en
        // reconnexion" pour que le processor outbound puisse la
        // distinguer d'une session simplement absente/jamais démarrée et
        // adapter son comportement de retry en conséquence.
        this.sockets.delete(sessionId);
        this.reconnectingSessions.add(sessionId);

        const reason = (lastDisconnect?.error as Boom)?.message ?? "unknown";
        console.log(`[whatsapp:${sessionId}] déconnecté (${reason}) — reconnexion dans ${RECONNECT_DELAY_MS}ms`);
        await enqueueWhatsappStatus({
          sessionId,
          tenantId,
          connectionStatus: "disconnected",
          disconnectReason: reason,
        });

        setTimeout(() => {
          if (this.loggedOutSessions.has(sessionId)) return;
          this.startSession(sessionId, tenantId).catch((err) => {
            console.error(`[whatsapp:${sessionId}] échec reconnexion:`, err);
            // La tentative de reconnexion elle-même a levé — on ne laisse
            // pas la session bloquée indéfiniment en "reconnecting" sans
            // qu'aucune nouvelle tentative ne soit planifiée. startSession
            // relèvera son propre "connection.update" en cas de succès
            // futur ; ce catch couvre uniquement l'échec synchrone
            // (ex: erreur réseau immédiate à l'appel).
          });
        }, RECONNECT_DELAY_MS);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        const from = msg.key.remoteJid;
        if (!from) continue;

        const text =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          null;

        // ─── Cas texte (chemin existant, inchangé) ───
        if (text) {
          await enqueueWhatsappInbound({
            sessionId,
            from,
            text,
            messageType: "text",
            receivedAt: new Date().toISOString(),
          });
          continue;
        }

        // ─── Cas image ───
        // imageMessage : screenshot/photo produit envoyé par le client (CDC
        // Phase 1). On télécharge, compresse sous 1 Mo, et enqueue avec le
        // buffer déjà prêt en base64 — le processor n'a plus qu'à
        // persister/transmettre, aucune dépendance Baileys en dehors de ce
        // fichier (cohérent avec la philosophie déjà actée : le worker
        // WhatsApp reste le seul point de contact avec Baileys).
        const imageMessage = msg.message.imageMessage;
        if (imageMessage) {
          try {
            const rawBuffer = (await downloadMediaMessage(
              msg,
              "buffer",
              {}
            )) as Buffer;

            const compressed = await compressImageToLimit(rawBuffer);

            if (!compressed) {
              console.warn(`[whatsapp:${sessionId}] image reçue rejetée — compression insuffisante sous 1 Mo`);
              await enqueueWhatsappInbound({
                sessionId,
                from,
                text: "[Image reçue mais illisible/trop volumineuse — le client a été informé]",
                messageType: "text",
                receivedAt: new Date().toISOString(),
              });
              continue;
            }

            // caption = légende éventuelle jointe à l'image côté WhatsApp
            const caption = imageMessage.caption ?? "";

            await enqueueWhatsappInbound({
              sessionId,
              from,
              text: caption,
              messageType: "image",
              mediaBase64: compressed.base64,
              mediaMimeType: compressed.mimeType,
              receivedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.error(`[whatsapp:${sessionId}] échec traitement image entrante :`, err instanceof Error ? err.message : err);
          }
          continue;
        }

        // Ni texte ni image exploitable (autre type de média, sticker,
        // etc.) — hors scope, ignoré comme avant.
      }
    });
  }

  async stopSession(sessionId: string, tenantId: string): Promise<void> {
    this.loggedOutSessions.add(sessionId);
    this.reconnectingSessions.delete(sessionId);

    const sock = this.sockets.get(sessionId);

    if (!sock) {
      await deleteControlPlaneAuthState(sessionId);
      await enqueueWhatsappStatus({ sessionId, tenantId, connectionStatus: "logged_out" });
      return;
    }

    await sock.logout();
    this.sockets.delete(sessionId);
  }
}

export const sessionManager = new SessionManager();