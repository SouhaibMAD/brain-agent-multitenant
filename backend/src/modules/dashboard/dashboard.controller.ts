import type { Request, Response } from "express";
import { getDashboardStats } from "./dashboard.service.js";

export async function getDashboardStatsHandler(req: Request, res: Response): Promise<void> {
  try {
    const stats = await getDashboardStats(req.params.tenantId as string);
    res.status(200).json(stats);
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