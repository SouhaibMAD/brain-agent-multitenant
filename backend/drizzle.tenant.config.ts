import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/tenant/schema.ts",
  out: "./src/db/migrations/tenant",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.TENANT_TEMPLATE_DATABASE_URL!,
  },
});