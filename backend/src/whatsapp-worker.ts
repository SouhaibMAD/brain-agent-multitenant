import "dotenv/config";
import { reconcileStaleSessionsOnStartup } from "./modules/whatsapp/whatsapp.service.js";

async function main() {
  // Doit s'exécuter AVANT l'import des processors — sinon un job "start"
  // pourrait théoriquement arriver et créer une nouvelle socket sur une
  // session que la réconciliation est en train de repasser à "stale" au
  // même moment (fenêtre de race improbable mais évitable gratuitement).
  await reconcileStaleSessionsOnStartup();

  await import("./queues/whatsapp-session-control.processor.js");
  await import("./queues/whatsapp-outbound.processor.js");

  console.log("WhatsApp worker démarré, en attente de jobs (session-control, outbound)...");
}

main().catch((err) => {
  console.error("[whatsapp-worker] échec fatal au démarrage:", err);
  process.exit(1);
});