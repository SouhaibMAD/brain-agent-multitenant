import "./ConversationList.css";

const STATUS_LABELS = {
  bot_active: "Bot actif",
  handover: "Handover",
  lead: "Lead",
};

function StatusDot({ status }) {
  // Le "pouls" ne pulse que quand le bot répond activement — s'éteint net
  // dès qu'un humain reprend la main (handover) ou qu'un lead est qualifié.
  const isAlive = status === "bot_active";
  return (
    <span
      className={`status-dot ${isAlive ? "status-dot-alive" : `status-dot-${status}`}`}
      aria-label={STATUS_LABELS[status] ?? status}
    />
  );
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

// Résolution du nom affiché, par ordre de préférence :
// 1. Nom du lead qualifié (le plus fiable, donné explicitement par le client)
// 2. Numéro de téléphone réel, si le JID est au format @s.whatsapp.net
//    (le numéro y est directement encodé, ex: 212716736361@s.whatsapp.net)
// 3. Identifiant @lid tronqué — WhatsApp masque volontairement le vrai numéro
//    derrière ce format, non décodable (voir ARCHITECTURE.md, BLOC 5)
function resolveDisplayName(c) {
  if (c.leadCustomerName) return c.leadCustomerName;

  if (c.customerIdentifier.endsWith("@s.whatsapp.net")) {
    const rawNumber = c.customerIdentifier.split("@")[0];
    return `+${rawNumber}`;
  }

  if (c.customerIdentifier.endsWith("@lid")) {
    const shortId = c.customerIdentifier.split("@")[0].slice(-6);
    return `Contact #${shortId}`;
  }

  return c.customerIdentifier;
}

export default function ConversationList({ conversations, isLoading, selectedId, onSelect }) {
  if (isLoading) {
    return <div className="conversation-list-empty">Chargement…</div>;
  }

  if (!conversations || conversations.length === 0) {
    return <div className="conversation-list-empty">Aucune conversation</div>;
  }

  return (
    <ul className="conversation-list">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`conversation-item ${selectedId === c.id ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <StatusDot status={c.status} />
            <div className="conversation-item-body">
              <div className="conversation-item-top">
                <span className="conversation-item-identifier">
                  {resolveDisplayName(c)}
                </span>
                <span className="conversation-item-time">
                  {formatRelativeTime(c.lastMessageAt)}
                </span>
              </div>
              <div className="conversation-item-preview">
                {c.lastMessageDirection === "outbound" ? "Vous : " : ""}
                {c.lastMessageContent || "Pas encore de message"}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}