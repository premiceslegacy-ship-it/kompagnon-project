-- ============================================================
-- 181 — Index vectoriel HNSW sur company_memory
-- ------------------------------------------------------------
-- Le commentaire de 057_embedding_qwen3.sql ("pgvector < 0.7 : ivfflat
-- et hnsw limités à 2000 dims, pas d'index pour l'instant") est périmé.
-- Vérifié en base le 2026-09-09 : pgvector 0.8.0 est installé. La
-- contrainte décrite n'existe plus dans cette version.
--
-- pgvector 0.8 introduit le type halfvec (flottants 16 bits), indexable
-- jusqu'à 4000 dimensions en hnsw/ivfflat. Les embeddings Qwen3 en font
-- 4096 : le cast simple embedding::halfvec(4096) échoue toujours avec
-- "column cannot have more than 4000 dimensions for hnsw index" (testé
-- en base). Il faut passer par subvector() pour retirer les 96 dernières
-- dimensions avant le cast — testé et confirmé fonctionnel en base :
--
--   hnsw ((subvector(embedding,1,4000)::halfvec(4000)) halfvec_cosine_ops)
--
-- Tronquer aux 4000 premières dimensions sur 4096 est légitime ici :
-- Qwen3-Embedding est entraîné en MRL (Matryoshka Representation
-- Learning), qui concentre l'information dans les premières dimensions.
-- L'index ne sert que de filtre de candidats : match_company_memory
-- classe ensuite sur le vecteur complet en 4096 dimensions (voir
-- 058_rag_function.sql), donc aucune perte de précision sur le résultat
-- retourné, seulement un gain de vitesse au-delà du volume actuel
-- (quelques dizaines de lignes, où le scan séquentiel reste optimal).
--
-- CONCURRENTLY non utilisé : Supabase applique les migrations dans une
-- transaction, comme documenté dans 159_perf_indexes.sql. Sur le volume
-- actuel (quelques dizaines de lignes par organisation), le verrou en
-- écriture est instantané.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_company_memory_embedding_hnsw
  ON public.company_memory
  USING hnsw ((subvector(embedding, 1, 4000)::halfvec(4000)) halfvec_cosine_ops)
  WHERE is_active = true AND embedding IS NOT NULL;
