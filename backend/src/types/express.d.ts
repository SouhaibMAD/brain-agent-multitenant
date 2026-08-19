import type { JwtPayload } from "../modules/auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenantRole?: "super_admin" | "admin_tenant" | "agent" | "viewer";
    }
  }
}

export {};