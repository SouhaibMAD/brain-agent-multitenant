import type { Request, Response } from "express";
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
  getUserById,
  changePassword
} from "./auth.service.js";

// Durée du cookie alignée sur REFRESH_EXPIRES_IN_DAYS (auth.service.ts) — 7 jours.
// Si cette valeur change côté service, la changer ici aussi (pas de source unique
// exposée par le service actuellement, cohérent avec le fait que la constante
// REFRESH_EXPIRES_IN_DAYS y est déjà privée/non exportée).
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const REFRESH_COOKIE_NAME = "refreshToken";

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: "/api/auth",
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

export async function registerHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = await registerUser(req.body);
    res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName });
  } catch (err) {
    if (err instanceof Error && err.message === "EMAIL_ALREADY_EXISTS") {
      res.status(409).json({ error: "EMAIL_ALREADY_EXISTS" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await loginUser(req.body);
    setRefreshCookie(res, result.refreshToken);
    // le refreshToken brut ne part plus jamais dans le JSON — seul le cookie httpOnly le porte
    res.status(200).json({ user: result.user, accessToken: result.accessToken });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(400).json({ error: "MISSING_REFRESH_TOKEN" });
      return;
    }
    const result = await refreshAccessToken(refreshToken);
    setRefreshCookie(res, result.refreshToken);
    res.status(200).json({ accessToken: result.accessToken });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_REFRESH_TOKEN") {
      clearRefreshCookie(res);
      res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  // protégée par authMiddleware (voir auth.routes.ts) — req.user est garanti présent ici
  const userId = req.user!.userId;
  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "USER_NOT_FOUND" });
    return;
  }
  res.status(200).json({ id: user.id, email: user.email, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin });
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  clearRefreshCookie(res);
  res.status(200).json({ success: true });
}
export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "INVALID_OR_MISSING_PASSWORD" });
    return;
  }

  try {
    await changePassword(userId, currentPassword, newPassword);
    clearRefreshCookie(res);
    res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_CURRENT_PASSWORD") {
      res.status(401).json({ error: "INVALID_CURRENT_PASSWORD" });
      return;
    }
    if (err instanceof Error && err.message === "PASSWORD_TOO_SHORT") {
      res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
      return;
    }
    if (err instanceof Error && err.message === "USER_NOT_FOUND") {
      res.status(404).json({ error: "USER_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}