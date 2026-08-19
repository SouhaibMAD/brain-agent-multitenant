CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "product_variants" ADD COLUMN "embedding" vector(384);

CREATE INDEX "product_variants_embedding_idx" ON "product_variants" 
  USING hnsw (embedding vector_cosine_ops);