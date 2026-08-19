import type { Request, Response } from "express";
import { getTenantDb } from "../../db/tenant-connection-manager.js";
import { listLeads, updateLeadStatus } from "./leads.service.js";
import type { LeadStatus } from "./leads.types.js";

// GET /:tenantId/leads?status=nouveau — liste des leads pour la page Leads
// du frontend (BLOC 6.3). Suit le même pattern que
// handleListConversations (module conversations) : résolution tenantDb via
// tenant-connection-manager, filtre optionnel par query param.
export async function handleListLeads(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId } = req.params;
    if (typeof tenantId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const statusFilter =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const tenantDb = await getTenantDb(tenantId);
    const result = await listLeads(tenantDb, statusFilter);
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

// PATCH /:tenantId/leads/:leadId — mise à jour manuelle du statut (agent/admin).
// status déjà validé par Zod (validate(updateLeadStatusSchema, "body")) en
// amont — le cast LeadStatus ici est sûr, pas une string arbitraire.
export async function handleUpdateLeadStatus(req: Request, res: Response): Promise<void> {
  try {
    const { tenantId, leadId } = req.params;
    if (typeof tenantId !== "string" || typeof leadId !== "string") {
      res.status(400).json({ error: "INVALID_OR_MISSING_PARAMS" });
      return;
    }

    const { status } = req.body as { status: LeadStatus };

    const tenantDb = await getTenantDb(tenantId);
    const result = await updateLeadStatus(tenantDb, leadId, status);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "LEAD_NOT_FOUND") {
      res.status(404).json({ error: "LEAD_NOT_FOUND" });
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