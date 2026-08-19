import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config/index.js";
import authRouter from "./modules/auth/auth.routes.js";
import tenantsRouter from "./modules/tenants/tenants.routes.js";
import productsRouter from "./modules/products/products.routes.js";
import agentRouter from "./modules/agent/agent.routes.js";
import tenantRolesRoutes from "./modules/tenant-roles/tenant-roles.routes.js";
import whatsappRoutes from "./modules/whatsapp/whatsapp.routes.js";
import conversationsRouter from "./modules/conversations/conversations.routes.js";
import leadsRouter from "./modules/leads/leads.routes.js";
import dashboardRouter from "./modules/dashboard/dashboard.routes.js";
import { shopifyRoutes } from './modules/shopify/shopify.routes.js';
import { shopifyWebhookRoutes } from './modules/shopify/shopify.webhook.routes.js';

const app = express();

app.use(
  cors({
    origin: config.corsAllowedOrigins,
    credentials: true,
  })
);

app.use('/', shopifyWebhookRoutes);

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/tenants", tenantsRouter);
app.use("/api/tenants", productsRouter);
app.use("/api/tenants", agentRouter);
app.use("/api/tenants", tenantRolesRoutes);
app.use("/api/tenants", whatsappRoutes);
app.use("/api/tenants", conversationsRouter);
app.use("/api/tenants", leadsRouter);
app.use("/api/tenants", dashboardRouter);
app.use('/api/tenants', shopifyRoutes);
export default app;