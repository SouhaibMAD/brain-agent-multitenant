import argon2 from "argon2";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/control/index.js";
import { users, refreshTokens } from "../../db/control/schema.js";
import { config } from "../../config/index.js";
import type { JwtPayload, LoginInput, RegisterInput } from "./auth.types.js";

const ACCESS_SECRET = config.jwt.accessSecret;
const REFRESH_SECRET = config.jwt.refreshSecret;
const ACCESS_EXPIRES_IN = config.jwt.accessExpiresIn as NonNullable<SignOptions["expiresIn"]>;
const REFRESH_EXPIRES_IN = config.jwt.refreshExpiresIn as NonNullable<SignOptions["expiresIn"]>;
const REFRESH_EXPIRES_IN_DAYS = 7; // doit rester cohérent avec JWT_REFRESH_EXPIRES_IN

// --- Hash / vérification password ---

export async function hashPassword(password: string): Promise<string> {
  // argon2id = variante recommandée OWASP (résistante GPU + side-channel)
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// --- Génération tokens ---

function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

function hashToken(token: string): string {
  // sha256 suffit ici : le refresh token est déjà aléatoire et long (contrairement à un password)
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function generateAndStoreRefreshToken(userId: string): Promise<string> {
  const rawToken = jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRES_IN_DAYS);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return rawToken;
}

// --- Register ---

export async function registerUser(input: RegisterInput) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  if (existing) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
    })
    .returning();

  if (!user) {
    throw new Error("USER_CREATION_FAILED");
  }  

  return user;
}

// --- Login ---

export async function loginUser(input: LoginInput) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!user || !user.isActive) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const validPassword = await verifyPassword(user.passwordHash, input.password);
  if (!validPassword) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = await generateAndStoreRefreshToken(user.id);

  return {
    user: { id: user.id, email: user.email, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin },
    accessToken,
    refreshToken,
  };
}

// --- Get current user (GET /auth/me) ---

export async function getUserById(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  return user ?? null;
}

// --- Refresh ---

export async function refreshAccessToken(rawRefreshToken: string) {
  let decoded: { userId: string };
  try {
    decoded = jwt.verify(rawRefreshToken, REFRESH_SECRET) as { userId: string };
  } catch {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  const tokenHash = hashToken(rawRefreshToken);

  const stored = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, decoded.userId),
  });
  if (!user || !user.isActive) {
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  // rotation : on révoque l'ancien et on en émet un nouveau
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, stored.id));

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const newRefreshToken = await generateAndStoreRefreshToken(user.id);

  return { accessToken, refreshToken: newRefreshToken };
}

// --- Logout ---

export async function revokeRefreshToken(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

// --- Changement de mot de passe ---

const MIN_PASSWORD_LENGTH = 8;

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
) {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error("PASSWORD_TOO_SHORT");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const validCurrentPassword = await verifyPassword(user.passwordHash, currentPassword);
  if (!validCurrentPassword) {
    throw new Error("INVALID_CURRENT_PASSWORD");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ passwordHash: newPasswordHash })
    .where(eq(users.id, userId));

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, userId));
}