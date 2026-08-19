import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/control/index.js";
import { users } from "../db/control/schema.js";

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, req.user.userId),
  });

  if (!user || !user.isSuperAdmin) {
    res.status(403).json({ error: "SUPER_ADMIN_REQUIRED" });
    return;
  }

  next();
}