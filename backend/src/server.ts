import "./api-workers.js"; // démarre les workers whatsapp-inbound/whatsapp-status
import app from "./app.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});