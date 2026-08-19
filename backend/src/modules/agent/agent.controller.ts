// src/modules/agent/agent.controller.ts

import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db as controlDb } from '../../db/control/index.js';
import { tenants } from '../../db/control/schema.js';
import { conversations } from '../../db/tenant/schema.js';
import { getTenantDb } from '../../db/tenant-connection-manager.js';
import { processIncomingMessage } from './agent.service.js';

interface AgentMessageRequestBody {
  conversationId?: string;
  channel?: string;
  content?: string;
  customerIdentifier?: string;
}

export async function handleAgentMessage(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== 'string') {
      res.status(400).json({ error: 'INVALID_OR_MISSING_TENANT_ID' });
      return;
    }

    const body = req.body as AgentMessageRequestBody;
    const channel = body.channel;
    const content = body.content;

    if (typeof content !== 'string' || content.trim() === '') {
      res.status(400).json({ error: 'CONTENT_REQUIRED' });
      return;
    }
    if (typeof channel !== 'string' || channel.trim() === '') {
      res.status(400).json({ error: 'CHANNEL_REQUIRED' });
      return;
    }

    // ─── Résolution du tenant (control plane) ───
    const [tenant] = await controlDb
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: 'TENANT_NOT_FOUND' });
      return;
    }

    // ─── Résolution de la connexion tenant (data plane) ───
    let tenantDb;
    try {
      tenantDb = await getTenantDb(tenantId);
    } catch (err) {
      if (err instanceof Error && err.message === 'TENANT_NOT_FOUND') {
        res.status(404).json({ error: 'TENANT_NOT_FOUND' });
        return;
      }
      if (err instanceof Error && err.message === 'TENANT_NOT_PROVISIONED') {
        res.status(409).json({ error: 'TENANT_NOT_PROVISIONED' });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR' });
      return;
    }

    // ─── Résolution / création de la conversation ───
    let conversationId = body.conversationId;

    if (conversationId) {
      const [existing] = await tenantDb
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
        return;
      }
    } else {
      const [created] = await tenantDb
        .insert(conversations)
        .values({
          channel,
          // 'test-postman' par défaut si aucun identifiant fourni — ce
          // endpoint est un outil de test manuel, pas le vrai flow
          // WhatsApp (BLOC 5). customerIdentifier optionnel permet de
          // simuler plusieurs faux clients distincts dans la même
          // session de test, sans se mélanger.
          customerIdentifier: body.customerIdentifier?.trim() || 'test-postman',
        })
        .returning({ id: conversations.id });
      conversationId = created!.id;
    }

    // ─── Délégation complète au service agent ───
    const result = await processIncomingMessage(
      tenantDb,
      { conversationId, channel, incomingContent: content },
      tenant.name
    );

    res.status(200).json({ conversationId, ...result });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}