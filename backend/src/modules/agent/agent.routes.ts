// backend/src/modules/agent/agent.routes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { tenantIdParamSchema, agentMessageSchema } from './agent.schemas.js';
import { handleAgentMessage } from './agent.controller.js';
import { getAgentConfigHandler } from "./agent-config.controller.js";

const router = Router({ mergeParams: true });

router.post(
  '/:tenantId/agent/message',
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, 'params'),
  validate(agentMessageSchema, 'body'),
  handleAgentMessage
);
router.get(
  "/:tenantId/agent/config",
  authMiddleware,
  tenantMiddleware,
  validate(tenantIdParamSchema, 'params'),
  getAgentConfigHandler
);

export default router;