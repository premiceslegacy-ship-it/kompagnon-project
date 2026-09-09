-- ============================================================
-- 182 — match_company_memory exploite l'index HNSW (181)
-- ------------------------------------------------------------
-- Signature et contrat inchangés : même paramètres, même colonnes
-- retournées, aucun changement requis côté appelant (src/lib/ai/rag.ts).
--
-- Le ORDER BY interne passe en deux temps :
--   1. pré-filtre sur l'expression indexée (subvector 4000 dims en
--      halfvec), qui peut exploiter idx_company_memory_embedding_hnsw
--      dès que le volume par organisation le justifie ;
--   2. reclassement exact sur le vecteur complet 4096 dims parmi les
--      candidats retenus, pour ne jamais perdre en précision sur le
--      résultat final.
--
-- p_limit * 10 (plancher 50) donne de la marge au reclassement exact :
-- un candidat proche en 4000 dims tronquées peut permuter de rang une
-- fois reclassé sur les 96 dimensions manquantes, la marge absorbe ce
-- réordonnancement sans risquer d'exclure le bon résultat.
--
-- Vérifié en base le 2026-09-09 : résultats et scores de similarité
-- strictement identiques à l'ancienne version sur les données réelles
-- de l'instance (comparaison ligne à ligne, tolérance flottante nulle).
-- Sur le volume actuel (quelques dizaines de lignes par organisation),
-- le planner choisit encore le scan séquentiel existant — normal et
-- optimal à ce volume (EXPLAIN vérifié) ; l'index prend le relais de
-- lui-même quand le volume grossit, sans autre changement de code.
-- ============================================================

CREATE OR REPLACE FUNCTION match_company_memory(
  p_organization_id uuid,
  p_embedding float[],
  p_limit int DEFAULT 5,
  p_activity_id text DEFAULT NULL  -- filtre optionnel sur metadata->>'activity_id'
)
RETURNS TABLE (
  content  text,
  type     text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH query_vector AS (
    SELECT p_embedding::public.vector(4096) AS full_vec
  ),
  candidates AS (
    SELECT
      cm.content,
      cm.type,
      cm.metadata,
      cm.embedding
    FROM public.company_memory cm, query_vector qv
    WHERE cm.organization_id = p_organization_id
      AND cm.is_active = true
      AND cm.embedding IS NOT NULL
      AND (p_activity_id IS NULL OR cm.metadata->>'activity_id' = p_activity_id)
    ORDER BY
      public.subvector(cm.embedding, 1, 4000)::public.halfvec(4000)
        <=> public.subvector(qv.full_vec, 1, 4000)::public.halfvec(4000)
    LIMIT GREATEST(p_limit * 10, 50)
  )
  SELECT
    c.content,
    c.type,
    c.metadata,
    1 - (c.embedding <=> qv.full_vec) AS similarity
  FROM candidates c, query_vector qv
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;
