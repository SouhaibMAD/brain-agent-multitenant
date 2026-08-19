import type { Request, Response } from "express";
import {
  createWhatsappSession,
  getWhatsappSessionQr,
  listWhatsappSessions,
  getWhatsappSessionStatus,
  disconnectWhatsappSession,
  reconnectWhatsappSession
} from "./whatsapp.service.js";

export async function handleCreateWhatsappSession(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
      return;
    }

    const result = await createWhatsappSession(tenantId);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function handleGetWhatsappSessionQr(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, sessionId } = req.params;
    if (typeof tenantId !== "string" || typeof sessionId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const qrDataUrl = await getWhatsappSessionQr(tenantId, sessionId);

    if (!qrDataUrl) {
      res.status(404).json({ error: "QR_NOT_AVAILABLE" });
      return;
    }

    res.status(200).json({ qr: qrDataUrl });
  } catch (err) {
    if (err instanceof Error && err.message === "WHATSAPP_SESSION_NOT_FOUND") {
      res.status(404).json({ error: "WHATSAPP_SESSION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function handleListWhatsappSessions(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_TENANT_ID" });
      return;
    }

    const sessions = await listWhatsappSessions(tenantId);
    res.status(200).json(sessions);
  } catch (err) {
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function handleGetWhatsappSessionStatus(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, sessionId } = req.params;
    if (typeof tenantId !== "string" || typeof sessionId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const session = await getWhatsappSessionStatus(tenantId, sessionId);
    res.status(200).json(session);
  } catch (err) {
    if (err instanceof Error && err.message === "WHATSAPP_SESSION_NOT_FOUND") {
      res.status(404).json({ error: "WHATSAPP_SESSION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

// ─── Nouveau — déconnexion manuelle ──────────────────────
export async function handleDisconnectWhatsappSession(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, sessionId } = req.params;
    if (typeof tenantId !== "string" || typeof sessionId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    await disconnectWhatsappSession(tenantId, sessionId);
    res.status(202).json({ status: "disconnect_requested" });
  } catch (err) {
    if (err instanceof Error && err.message === "WHATSAPP_SESSION_NOT_FOUND") {
      res.status(404).json({ error: "WHATSAPP_SESSION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

// ─── Nouveau — relance d'une session stale ───────────────
export async function handleReconnectWhatsappSession(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, sessionId } = req.params;
    if (typeof tenantId !== "string" || typeof sessionId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    await reconnectWhatsappSession(tenantId, sessionId);
    res.status(202).json({ status: "reconnect_requested" });
  } catch (err) {
    if (err instanceof Error && err.message === "WHATSAPP_SESSION_NOT_FOUND") {
      res.status(404).json({ error: "WHATSAPP_SESSION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "SESSION_NOT_STALE") {
      res.status(409).json({ error: "SESSION_NOT_STALE" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "TENANT_NOT_PROVISIONED") {
      res.status(409).json({ error: "TENANT_NOT_PROVISIONED" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}