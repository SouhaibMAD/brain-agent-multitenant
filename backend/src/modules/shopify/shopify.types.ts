// src/modules/shopify/shopify.types.ts

// ─── Payload Shopify (Admin API REST + webhook — même forme) ───
// Shopify envoie exactement le même format de "product" en réponse
// GET /admin/api/{version}/products.json et dans le body des webhooks
// products/create, products/update. On modélise uniquement les champs
// exploités par notre mapping.

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string; // Shopify envoie toujours une string, ex: "24.95"
  sku: string | null; // souvent null sur les stores de démo/certains produits
  inventory_quantity: number | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  product_type: string | null;
  tags: string; // string CSV côté Shopify, ex: "Accessory, Sport, Winter"
  status: string; // 'active' | 'archived' | 'draft'
  variants: ShopifyVariant[];
  image: { src: string } | null;
  images: { src: string }[];
}

export interface ShopifyProductsListResponse {
  products: ShopifyProduct[];
}

// ─── Webhook topics gérés ───
export type ShopifyWebhookTopic =
  | 'products/create'
  | 'products/update'
  | 'products/delete';

// ─── Connexion stockée ───
export interface ShopifyConnectionInput {
  shopDomain: string;
  accessToken: string;
  scopes?: string;
}

// ─── Résultat de sync (même forme que ImportResult pour cohérence UI) ───
export interface ShopifySyncResult {
  totalProducts: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ shopifyProductId: string; reason: string }>;
}