import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../modules/auth/auth.types.js";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "MISSING_TOKEN" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as JwtPayload;
    req.user = decoded;

    // Toute réponse authentifiée est potentiellement spécifique à l'utilisateur —
    // interdit explicitement au navigateur/proxy intermédiaire de la mettre en cache
    // et de la resservir (ex: 304 Not Modified) à une session différente sur la même
    // URL. Sans ça, changer de compte peut faire "voir" les données du compte précédent.
    res.setHeader("Cache-Control", "no-store");

    next();
  } catch {
    res.status(401).json({ error: "INVALID_OR_EXPIRED_TOKEN" });
  }
}