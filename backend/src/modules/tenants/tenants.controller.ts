import type { Request, Response } from "express";
import { createTenant, listTenants, deactivateTenant } from "./tenants.service.js";

export async function createTenantHandler(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await createTenant(req.body);
    res.status(201).json(tenant);
  } catch (err) {
    if (err instanceof Error && err.message === "SLUG_ALREADY_EXISTS") {
      res.status(409).json({ error: "SLUG_ALREADY_EXISTS" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function listTenantsHandler(_req: Request, res: Response): Promise<void> {
  const tenants = await listTenants();
  res.status(200).json(tenants);
}

export async function deactivateTenantHandler(req: Request, res: Response): Promise<void> {
  try {
    const tenant = await deactivateTenant(req.params.tenantId as string);
    res.status(200).json(tenant);
  } catch (err) {
    if (err instanceof Error && err.message === "TENANT_NOT_FOUND") {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}