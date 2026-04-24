-- Passage de text-embedding-3-small (1536) à Qwen3-Embedding-8B (4096)
-- Les entrées existantes avec embedding NOT NULL devront être re-générées

-- Dropper l'index ivfflat existant avant l'ALTER COLUMN
DROP INDEX IF EXISTS idx_company_memory_embedding;

-- Vider les embeddings 1536 dims avant de redimensionner la colonne
UPDATE public.company_memory SET embedding = NULL WHERE embedding IS NOT NULL;

ALTER TABLE public.company_memory
  ALTER COLUMN embedding TYPE public.vector(4096);

COMMENT ON COLUMN public.company_memory.embedding IS 'Qwen3-Embedding-8B via OpenRouter — 4096 dims';

-- pgvector < 0.7 : ivfflat et hnsw limités à 2000 dims, pas d'index pour l'instant.
-- Scan séquentiel suffisant tant que company_memory reste < quelques milliers de lignes.
-- À revisiter si upgrade pgvector ou volume important.
