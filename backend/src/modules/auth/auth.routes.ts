// backend/src/modules/auth/auth.routes.ts
import { Router } from "express";
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  changePasswordHandler
} from "./auth.controller.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { loginRateLimiter } from "../../middleware/rateLimit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { registerSchema, loginSchema, changePasswordSchema } from "./auth.schemas.js";

const router = Router();

router.post("/register", validate(registerSchema), registerHandler);
router.post("/login", loginRateLimiter, validate(loginSchema), loginHandler);
router.post("/refresh", refreshHandler);
router.post("/logout", logoutHandler);
router.get("/me", authMiddleware, meHandler);
router.patch("/password", authMiddleware, validate(changePasswordSchema), changePasswordHandler);

export default router;