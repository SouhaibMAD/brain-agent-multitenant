import { Worker, Job, UnrecoverableError } from "bullmq";
import { connection } from "./redis-connection.js";
import type { WhatsappOutboundJobData } from "./whatsapp-outbound.queue.js";
import { sessionManager } from "../modules/whatsapp/session-manager.js";

async function processOutboundJob(job: Job<WhatsappOutboundJobData>) {
  const { sessionId, to, text } = job.data;

  if (sessionManager.isLoggedOut(sessionId)) {
    // Session définitivement morte (vrai logout WhatsApp) — jamais de
    // retry, ça n'a aucune chance de réussir plus tard sans reconnexion
    // manuelle (nouveau QR).
    throw new UnrecoverableError("SESSION_LOGGED_OUT");
  }

  const sock = sessionManager.getSocket(sessionId);
  if (!sock) {
    // Deux cas distincts derrière un socket absent, désormais
    // discernables via sessionManager.isReconnecting() (voir
    // session-manager.ts) :
    //
    //  - Session en cours de reconnexion transitoire (coupure Baileys
    //    passagère, ex: code 515) : le socket réapparaîtra dans quelques
    //    secondes. C'est le cas qui provoquait des échecs définitifs
    //    avant ce correctif — les 3 tentatives par défaut (backoff
    //    exponentiel ~3s/6s) pouvaient s'épuiser entièrement DANS la
    //    fenêtre de reconnexion (RECONNECT_DELAY_MS = 5000ms côté
    //    session-manager.ts + temps de connexion réel Baileys derrière).
    //    On lève une erreur "normale" (pas Unrecoverable) : BullMQ va
    //    retry selon la politique de la queue, désormais élargie pour
    //    couvrir confortablement cette fenêtre (voir
    //    whatsapp-outbound.queue.ts).
    //
    //  - Session jamais démarrée / réellement absente (mauvais
    //    sessionId, session jamais connectée) : même erreur levée, même
    //    comportement de retry — au pire on épuise les tentatives un peu
    //    plus lentement qu'avant sur un cas qui échouera de toute façon,
    //    ce qui est un compromis acceptable plutôt que de risquer de
    //    couper trop court une reconnexion légitime en cours.
    if (sessionManager.isReconnecting(sessionId)) {
      throw new Error("SESSION_RECONNECTING");
    }
    throw new Error("SESSION_NOT_ACTIVE");
  }

  await sock.sendMessage(to, { text });
  return { sessionId, to };
}

export const whatsappOutboundWorker = new Worker<WhatsappOutboundJobData>(
  "whatsapp-outbound",
  processOutboundJob,
  { connection }
);

whatsappOutboundWorker.on("completed", (job) => {
  console.log(`[outbound] message envoyé, session ${job.data.sessionId}`);
});

whatsappOutboundWorker.on("failed", (job, err) => {
  const attemptsInfo = job ? `tentative ${job.attemptsMade}/${job.opts.attempts}` : "tentative inconnue";
  console.error(`[outbound] échec envoi, session ${job?.data.sessionId} (${attemptsInfo}):`, err.message);
});