// backend/src/middleware/validate.middleware.ts
import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

type ValidationTarget = "body" | "query" | "params";

/**
 * Middleware de validation générique.
 *
 * Express 5 rend req.query un getter pur (recalculé depuis req.url à chaque
 * accès) — une réassignation directe (req.query = X) ou une mutation de
 * l'objet retourné par le getter (Object.assign(req.query, X)) échoue
 * silencieusement ou ne persiste pas : le prochain accès à req.query
 * redéclenche le getter et reconstruit depuis l'URL brute, perdant toute
 * coercion Zod (string → number/boolean/enum).
 *
 * Fix : redéfinir la propriété elle-même avec Object.defineProperty
 * (configurable: true permet de la redéfinir, contrairement à une simple
 * assignation qui échoue sur un getter-only). req.params n'a pas ce
 * problème (propriété normale, réassignable), mais on applique le même
 * mécanisme aux deux pour rester cohérent et robuste à un futur changement
 * d'Express.
 */
export function validate(schema: ZodType, target: ValidationTarget = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      res.status(400).json({
        error: "VALIDATION_FAILED",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    Object.defineProperty(req, target, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    next();
  };
}