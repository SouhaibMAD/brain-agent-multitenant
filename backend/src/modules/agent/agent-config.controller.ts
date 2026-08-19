import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db as controlDb } from "../../db/control/index.js";
import { tenants } from "../../db/control/schema.js";
import { buildSystemPrompt } from "./agent.prompt.js";

/**
 * Lecture seule (BLOC 7.4) : affiche le prompt système actuellement utilisé
 * par l'agent pour ce tenant, tel que buildSystemPrompt() le génère réellement
 * — pas une copie figée qui pourrait diverger du prompt réel en production.
 * Pas d'édition en V1 : le CDC ne demande qu'un "affichage minimal".
 */
export async function getAgentConfigHandler(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = req.params.tenantId as string;

    const tenant = await controlDb.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }

    res.status(200).json({
      tenantName: tenant.name,
      systemPrompt: buildSystemPrompt(tenant.name),
    });
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}