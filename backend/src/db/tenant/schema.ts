// C:\Users\DELL Tac\Desktop\brain-agent-multitenant\backend\src\db\tenant\schema.ts:
import { pgTable, uuid, varchar, numeric, integer, text, jsonb, timestamp, index, uniqueIndex, customType, boolean } from 'drizzle-orm/pg-core';

import { relations, sql } from 'drizzle-orm';

// ─── CUSTOM TYPE : tsvector ──────────────────────────────
// Drizzle n'a pas de helper natif pour tsvector. On le déclare comme un
// type custom en lecture seule côté TypeScript — la valeur réelle est
// calculée par Postgres via GENERATED ALWAYS AS (...) STORED dans la
// migration SQL, jamais écrite depuis l'application.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});
const vector384 = customType<{ data: number[] }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});

// ─── PRODUCTS (descriptif pur) ──────────────────────────
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  productRef: varchar('product_ref', { length: 100 }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }), // nullable, varchar libre — cohérent avec channel/direction
  shopifyProductId: varchar('shopify_product_id', { length: 50 }),
  imageUrl: varchar('image_url', { length: 500 }),
  images: jsonb('images').$type<string[]>().default([]),
  tags: jsonb('tags').$type<string[]>().default([]),
  searchVector: tsvector('search_vector'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  tagsGinIdx: index('products_tags_gin_idx').using('gin', table.tags),
  productRefUnique: uniqueIndex('products_product_ref_unique').on(table.productRef),
  searchVectorGinIdx: index('products_search_vector_gin_idx').using('gin', table.searchVector),
  categoryIdx: index('products_category_idx').on(table.category), // filtre ILIKE fréquent depuis l'agent
  shopifyProductIdUnique: uniqueIndex('products_shopify_product_id_unique').on(table.shopifyProductId),
}));

// ─── PRODUCT_VARIANTS (vendable : sku, prix, stock) ─────
export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 100 }),
  shopifyVariantId: varchar('shopify_variant_id', { length: 50 }),
  attributes: jsonb('attributes').$type<Record<string, string>>().default({}),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  stock: integer('stock').notNull().default(0),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }), // nouveau — dénormalisé depuis products.name, pour permettre la colonne générée search_vector ci-dessous
  searchVector: tsvector('search_vector'), // nouveau — colonne générée par Postgres (STORED), voir migration 0004. Ne JAMAIS assigner depuis Drizzle, comme pour products.searchVector.
  embedding: vector384('embedding'), // nouveau
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  skuUnique: uniqueIndex('product_variants_sku_unique').on(table.sku),
  productIdx: index('product_variants_product_idx').on(table.productId),
  // Index pour la recherche exacte/partielle par SKU (recherche catalogue, BLOC 4)
  skuSearchIdx: index('product_variants_sku_search_idx').on(table.sku),
  shopifyVariantIdUnique: uniqueIndex('product_variants_shopify_variant_id_unique').on(table.shopifyVariantId),
}));


// ─── MESSAGES ───────────────────────────────────────────
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: varchar('direction', { length: 20 }).notNull(), // 'inbound' | 'outbound'
  content: text('content').notNull(),
  messageType: varchar('message_type', { length: 20 }).notNull().default('text'), // 'text' | 'image'
  mediaBase64: text('media_base64'), // nouveau — image compressée, présente uniquement si messageType === 'image'
  mediaMimeType: varchar('media_mime_type', { length: 100 }), // nouveau — ex: 'image/jpeg'
  sentAt: timestamp('sent_at').notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index('messages_conversation_idx').on(table.conversationId),
}));

// ─── LEADS ──────────────────────────────────────────────
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }), // nullable
  customerName: varchar('customer_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  productRequested: varchar('product_requested', { length: 255 }),
  variant: varchar('variant', { length: 255 }),
  quantity: integer('quantity').default(1),
  estimatedPrice: numeric('estimated_price', { precision: 10, scale: 2 }),
  channel: varchar('channel', { length: 50 }).notNull(),
  leadStatus: varchar('lead_status', { length: 50 }).notNull().default('nouveau'),
  // 'nouveau' | 'qualifie' | 'en_attente_confirmation' | 'confirme' | 'annule' | 'transfere_humain' — CDC §3.10
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  channelIdx: index('leads_channel_idx').on(table.channel),
  statusIdx: index('leads_status_idx').on(table.leadStatus),
}));

// ─── ORDERS ─────────────────────────────────────────────
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }), // nullable
  orderStatus: varchar('order_status', { length: 50 }).notNull().default('en_attente'),
  // 'en_attente' | 'confirme' | 'annule'
  totalPrice: numeric('total_price', { precision: 10, scale: 2 }),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('orders_status_idx').on(table.orderStatus),
}));

// ─── WHATSAPP_SESSIONS ──────────────────────────────────
export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: varchar('phone_number', { length: 50 }),
  connectionStatus: varchar('connection_status', { length: 50 }).notNull().default('pending_qr'),
  lastConnectedAt: timestamp('last_connected_at'),
  lastDisconnectReason: varchar('last_disconnect_reason', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─── SHOPIFY_CONNECTIONS ─────────────────────────────────
// Credentials de connexion Shopify (Custom App legacy, token statique).
// Table tenant-scoped — pas de tenant_id nécessaire, le scoping est déjà
// assuré par database-per-tenant (même logique que whatsapp_sessions).
export const shopifyConnections = pgTable('shopify_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull(),
  accessToken: text('access_token').notNull(),
  scopes: varchar('scopes', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  shopDomainUnique: uniqueIndex('shopify_connections_shop_domain_unique').on(table.shopDomain),
}));


// ─── CONVERSATIONS ──────────────────────────────────────
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  channel: varchar('channel', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('bot_active'),
  customerIdentifier: varchar('customer_identifier', { length: 255 }).notNull(),
  whatsappSessionId: uuid('whatsapp_session_id').references(() => whatsappSessions.id, { onDelete: 'set null' }),
  botEnabled: boolean('bot_enabled').notNull().default(true), // nouveau — indépendant de status, contrôle si l'agent répond automatiquement
  internalNotes: text('internal_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  channelIdx: index('conversations_channel_idx').on(table.channel),
}));

// ─── RELATIONS (pour requêtes Drizzle avec `.query`) ────
export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  leads: many(leads),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [leads.conversationId],
    references: [conversations.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  lead: one(leads, {
    fields: [orders.leadId],
    references: [leads.id],
  }),
}));