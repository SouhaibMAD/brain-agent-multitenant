import { pgTable, uuid, text, timestamp, boolean, pgEnum, unique, jsonb, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";

// Rôles possibles définis dans le CDC (section 3.2)
export const roleEnum = pgEnum("role", ["super_admin", "admin_tenant", "agent", "viewer"]);

// Chaque ligne = un tenant/client de la plateforme.
// JAMAIS de données métier (produits, conversations...)
// QUI est ce tenant & OU trouver sa base de données.
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(), // nom commercial
  slug: text("slug").notNull().unique(), // identifiant technique unique
  databaseUrl: text("database_url"), // retrait de .notNull() — nullable tant que le provisioning n'est pas terminé
  neonProjectId: text("neon_project_id"), // nouveau — id du projet Neon associé, pour pouvoir le gérer/supprimer via l'API plus tard
  provisioningStatus: text("provisioning_status").notNull().default("pending"), // nouveau — 'pending' | 'ready' | 'failed'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});


// Les humains qui utilisent la plateforme (agents, admins).
// Indépendant des tenants — même user lié à plusieurs tenants
// via la table de liaison user_tenant_roles ci-dessous.
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // jamais le mot de passe en clair
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Table de liaison : "cet utilisateur a ce rôle sur ce tenant".
// Permet à un agent humain de gérer plusieurs tenants avec des rôles différents.
export const userTenantRoles = pgTable(
  "user_tenant_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ([
    // un utilisateur ne peut avoir qu'UN rôle sur un tenant donné
    unique("unique_user_tenant").on(table.userId, table.tenantId),
  ])
);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(), // on stocke le hash du refresh token, jamais en clair
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"), // null = actif, sinon révoqué (logout/rotation)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const whatsappCredentials = pgTable("whatsapp_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().unique(), // = whatsappSessions.id côté tenant, référence logique cross-DB
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  credsJson: jsonb("creds_json").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappSignalKeys = pgTable(
  "whatsapp_signal_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(), // = whatsappSessions.id côté tenant
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }), // dénormalisé depuis whatsappCredentials — permet le cascade direct sans jointure, cohérent avec productNameSnapshot (BLOC 4)
    keyType: varchar("key_type", { length: 50 }).notNull(),
    keyId: varchar("key_id", { length: 255 }).notNull(),
    keyData: jsonb("key_data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ([
    unique("unique_session_keytype_keyid").on(table.sessionId, table.keyType, table.keyId),
    index("whatsapp_signal_keys_session_idx").on(table.sessionId),
  ])
);

// ─── SHOPIFY_SHOP_MAPPINGS ───────────────────────────────
// Résout shop_domain → tenantId pour les webhooks entrants Shopify, qui
// n'ont pas de tenantId dans l'URL (juste un header shop_domain). Même
// logique que le mapping sessionId → tenantId sur whatsapp_signal_keys
// (BLOC 5) — nécessaire dès qu'un webhook externe doit être routé vers
// le bon tenant avant même d'avoir ouvert sa connexion DB.
export const shopifyShopMappings = pgTable('shopify_shop_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  shopDomainUnique: uniqueIndex('shopify_shop_mappings_shop_domain_unique').on(table.shopDomain),
}));