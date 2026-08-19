import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useTenant } from "../../contexts/TenantContext";
import "./WhatsappConnection.css";

async function fetchSessions(tenantId) {
  const { data } = await apiClient.get(`/tenants/${tenantId}/whatsapp/sessions`);
  return data;
}

async function fetchQr(tenantId, sessionId) {
  try {
    const { data } = await apiClient.get(
      `/tenants/${tenantId}/whatsapp/sessions/${sessionId}/qr`
    );
    return data.qr;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

async function createSession(tenantId) {
  const { data } = await apiClient.post(`/tenants/${tenantId}/whatsapp/sessions`);
  return data;
}

async function disconnectSession(tenantId, sessionId) {
  const { data } = await apiClient.post(
    `/tenants/${tenantId}/whatsapp/sessions/${sessionId}/disconnect`
  );
  return data;
}

async function reconnectSession(tenantId, sessionId) {
  const { data } = await apiClient.post(
    `/tenants/${tenantId}/whatsapp/sessions/${sessionId}/reconnect`
  );
  return data;
}

function getActionErrorMessage(error, actionLabel) {
  if (error?.response?.status === 403) {
    return `Votre rôle ne permet pas ${actionLabel} — action réservée à l'administrateur du tenant.`;
  }
  return `Échec : ${actionLabel} a échoué. Réessayez.`;
}

function StatusBadge({ status }) {
  const map = {
    connected: { label: "Connecté", cls: "wa-badge-connected" },
    pending_qr: { label: "En attente de scan", cls: "wa-badge-pending" },
    disconnected: { label: "Déconnecté (reconnexion...)", cls: "wa-badge-pending" },
    logged_out: { label: "Déconnecté", cls: "wa-badge-alert" },
    stale: { label: "À relancer (redémarrage serveur)", cls: "wa-badge-alert" },
  };
  const info = map[status] ?? { label: status, cls: "wa-badge-pending" };
  return <span className={`wa-badge ${info.cls}`}>{info.label}</span>;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function QrPanel({ tenantId, sessionId, onCancel, cancelling }) {
  const { data: qr, isLoading } = useQuery({
    queryKey: ["whatsapp-qr", tenantId, sessionId],
    queryFn: () => fetchQr(tenantId, sessionId),
    refetchInterval: 3000,
  });

  return (
    <div className="wa-qr-panel">
      <div className="wa-qr-frame">
        {isLoading && !qr && <div className="wa-qr-loading">Génération du QR…</div>}
        {qr && <img src={qr} alt="QR code WhatsApp" className="wa-qr-image" />}
        {!isLoading && !qr && (
          <div className="wa-qr-loading">
            QR non disponible pour l'instant — nouvelle tentative automatique…
          </div>
        )}
      </div>
      <ol className="wa-qr-steps">
        <li>Ouvrez WhatsApp sur le téléphone du numéro à connecter</li>
        <li>Allez dans Paramètres → Appareils liés → Lier un appareil</li>
        <li>Scannez ce QR code</li>
      </ol>
      <p className="wa-qr-note">
        Après le scan, la connexion peut prendre jusqu'à ~6 minutes à se stabiliser
        (limitation connue de l'écosystème WhatsApp non-officiel). C'est normal, pas
        besoin de rescanner.
      </p>
      <button
        type="button"
        className="wa-cancel-qr-btn"
        onClick={onCancel}
        disabled={cancelling}
      >
        {cancelling ? "Annulation…" : "Annuler et générer un nouveau QR"}
      </button>
    </div>
  );
}

function StalePanel({ tenantId, sessionId, onReconnect, reconnecting, canManageConnection }) {
  return (
    <div className="wa-connected-panel">
      <div className="wa-connected-info">
        <StatusBadge status="stale" />
        <span className="wa-connected-phone">
          Le serveur a redémarré — cette session doit être relancée pour reprendre l'envoi/réception.
        </span>
      </div>
      <button
        type="button"
        className="wa-disconnect-btn"
        onClick={onReconnect}
        disabled={reconnecting || !canManageConnection}
        title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
      >
        {!canManageConnection
          ? "Réservé à l'admin"
          : reconnecting
          ? "Relance…"
          : "Relancer la session"}
      </button>
    </div>
  );
}

export default function WhatsappConnection() {
  const tenant = useTenant();
  const { tenantId } = tenant;
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [reconnectingId, setReconnectingId] = useState(null);

  const canManageConnection = tenant.role === "admin_tenant";

  const { data: sessions, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["whatsapp-sessions", tenantId],
    queryFn: () => fetchSessions(tenantId),
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (!disconnectingId || !sessions) return;
    const target = sessions.find((s) => s.id === disconnectingId);
    const stillActive = target && (target.connectionStatus === "connected" || target.connectionStatus === "pending_qr");
    if (!stillActive) {
        setDisconnectingId(null);
    }
    }, [sessions, disconnectingId]);

  useEffect(() => {
    if (!reconnectingId || !sessions) return;
    const target = sessions.find((s) => s.id === reconnectingId);
    const stillStale = target && target.connectionStatus === "stale";
    if (!stillStale) {
      setReconnectingId(null);
    }
  }, [sessions, reconnectingId]);

  const createMutation = useMutation({
    mutationFn: () => createSession(tenantId),
    onMutate: () => setCreating(true),
    onSettled: () => setCreating(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions", tenantId] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (sessionId) => disconnectSession(tenantId, sessionId),
    onMutate: (sessionId) => setDisconnectingId(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions", tenantId] });
    },
    onError: () => setDisconnectingId(null),
  });

  const reconnectMutation = useMutation({
    mutationFn: (sessionId) => reconnectSession(tenantId, sessionId),
    onMutate: (sessionId) => setReconnectingId(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions", tenantId] });
    },
    onError: () => setReconnectingId(null),
  });

  if (isLoading) {
    return <div className="wa-shell">Chargement…</div>;
  }

  const activeSession = [...(sessions ?? [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .find((s) =>
      s.connectionStatus === "connected" ||
      s.connectionStatus === "pending_qr" ||
      s.connectionStatus === "stale"
    );

  return (
    <div className="wa-shell">
      <div className="wa-header">
        <h1 className="wa-title">Connexion WhatsApp</h1>
        <div className="wa-header-actions">
          <button
            type="button"
            className="wa-refresh-btn"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Rafraîchir le statut"
          >
            {isFetching ? "…" : "Rafraîchir"}
          </button>
          {!activeSession && (
            <button
              type="button"
              className="wa-connect-btn"
              onClick={() => createMutation.mutate()}
              disabled={creating || !canManageConnection}
              title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
            >
              {!canManageConnection
                ? "Réservé à l'admin"
                : creating
                ? "Création…"
                : "Connecter WhatsApp"}
            </button>
          )}
        </div>
      </div>

      {!canManageConnection && (
        <div className="wa-permission-notice">
          Votre rôle vous permet de consulter le statut de connexion, mais seul un
          administrateur du tenant peut connecter ou déconnecter une session WhatsApp.
        </div>
      )}

      {(createMutation.isError || disconnectMutation.isError || reconnectMutation.isError) && (
        <div className="wa-permission-notice wa-permission-notice--error">
          {getActionErrorMessage(
            createMutation.isError
              ? createMutation.error
              : disconnectMutation.isError
              ? disconnectMutation.error
              : reconnectMutation.error,
            createMutation.isError
              ? "de créer une session"
              : disconnectMutation.isError
              ? "de déconnecter cette session"
              : "de relancer cette session"
          )}
        </div>
      )}

      {!sessions?.length && !activeSession && (
        <div className="wa-empty-state">
          Aucune session WhatsApp pour ce tenant. Cliquez sur "Connecter WhatsApp" pour
          générer un QR code.
        </div>
      )}

    {activeSession?.connectionStatus === "pending_qr" && (
    <QrPanel
        tenantId={tenantId}
        sessionId={activeSession.id}
        onCancel={() => disconnectMutation.mutate(activeSession.id)}
        cancelling={disconnectingId === activeSession.id}
    />
    )}

      {activeSession?.connectionStatus === "stale" && (
        <StalePanel
          tenantId={tenantId}
          sessionId={activeSession.id}
          onReconnect={() => reconnectMutation.mutate(activeSession.id)}
          reconnecting={reconnectingId === activeSession.id}
          canManageConnection={canManageConnection}
        />
      )}

      {activeSession?.connectionStatus === "connected" && (
        <div className="wa-connected-panel">
          <div className="wa-connected-info">
            <StatusBadge status="connected" />
            <span className="wa-connected-phone">{activeSession.phoneNumber}</span>
          </div>
          <button
            type="button"
            className="wa-disconnect-btn"
            onClick={() => disconnectMutation.mutate(activeSession.id)}
            disabled={disconnectingId === activeSession.id || !canManageConnection}
            title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
          >
            {!canManageConnection
              ? "Réservé à l'admin"
              : disconnectingId === activeSession.id
              ? "Déconnexion…"
              : "Déconnecter"}
          </button>
        </div>
      )}

      {sessions?.length > 0 && (
        <div className="wa-sessions-list">
          <h2 className="wa-subtitle">Historique des sessions</h2>
          <table className="wa-table">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th>Créée le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.phoneNumber ?? "—"}</td>
                  <td><StatusBadge status={s.connectionStatus} /></td>
                  <td>{formatDate(s.lastConnectedAt)}</td>
                  <td>{formatDate(s.createdAt)}</td>
                  <td>
                    {s.connectionStatus === "connected" && (
                      <button
                        type="button"
                        className="wa-table-disconnect-btn"
                        onClick={() => disconnectMutation.mutate(s.id)}
                        disabled={disconnectingId === s.id || !canManageConnection}
                        title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
                      >
                        {disconnectingId === s.id ? "…" : "Déconnecter"}
                      </button>
                    )}
                    {s.connectionStatus === "stale" && (
                      <button
                        type="button"
                        className="wa-table-disconnect-btn"
                        onClick={() => reconnectMutation.mutate(s.id)}
                        disabled={reconnectingId === s.id || !canManageConnection}
                        title={!canManageConnection ? "Réservé à l'admin tenant" : undefined}
                      >
                        {reconnectingId === s.id ? "…" : "Relancer"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}