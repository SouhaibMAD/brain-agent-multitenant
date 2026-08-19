import type { Request, Response } from "express";
import {
  sendManualMessage,
  toggleBotForConversation,
  resumeConversationFromHandover,
  listConversations,
  getConversationMessages,
  appendInternalNote
} from "./conversations.service.js";

interface SendManualMessageBody {
  content?: string;
}
interface AppendNoteBody {
  content?: string;
}
 
export async function handleSendManualMessage(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, conversationId } = req.params;
    if (typeof tenantId !== "string" || typeof conversationId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const body = req.body as SendManualMessageBody;
    if (typeof body.content !== "string" || body.content.trim() === "") {
      res.status(400).json({ error: "CONTENT_REQUIRED" });
      return;
    }

    const result = await sendManualMessage(tenantId, conversationId, body.content);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "WHATSAPP_SESSION_NOT_LINKED") {
      res.status(409).json({ error: "WHATSAPP_SESSION_NOT_LINKED" });
      return;
    }
    if (err instanceof Error && err.message === "CHANNEL_NOT_SUPPORTED_FOR_MANUAL_SEND") {
      res.status(422).json({ error: "CHANNEL_NOT_SUPPORTED_FOR_MANUAL_SEND" });
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

interface ToggleBotBody {
  enabled?: boolean;
}

export async function handleToggleBot(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, conversationId } = req.params;
    if (typeof tenantId !== "string" || typeof conversationId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const body = req.body as ToggleBotBody;
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "ENABLED_REQUIRED" });
      return;
    }

    const result = await toggleBotForConversation(tenantId, conversationId, body.enabled);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
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

export async function handleResumeConversation(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, conversationId } = req.params;
    if (typeof tenantId !== "string" || typeof conversationId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const result = await resumeConversationFromHandover(tenantId, conversationId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
      return;
    }
    if (err instanceof Error && err.message === "CONVERSATION_NOT_IN_HANDOVER") {
      res.status(409).json({ error: "CONVERSATION_NOT_IN_HANDOVER" });
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

// GET /:tenantId/conversations?status=handover — liste pour la colonne
// gauche de l'inbox. status est optionnel (pas de filtre = tout afficher).
export async function handleListConversations(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const statusFilter =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const result = await listConversations(tenantId, statusFilter);
    res.status(200).json(result);
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

// GET /:tenantId/conversations/:conversationId/messages — thread complet,
// pour la vue détail de l'inbox.
export async function handleGetConversationMessages(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { tenantId, conversationId } = req.params;
    if (typeof tenantId !== "string" || typeof conversationId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const result = await getConversationMessages(tenantId, conversationId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
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
export async function handleAppendNote(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, conversationId } = req.params;
    if (typeof tenantId !== "string" || typeof conversationId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }
 
    const body = req.body as AppendNoteBody;
    if (typeof body.content !== "string" || body.content.trim() === "") {
      res.status(400).json({ error: "CONTENT_REQUIRED" });
      return;
    }
 
    const authorLabel = req.user!.email;
    const result = await appendInternalNote(
      tenantId,
      conversationId,
      authorLabel,
      body.content.trim()
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "CONVERSATION_NOT_FOUND") {
      res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
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
 