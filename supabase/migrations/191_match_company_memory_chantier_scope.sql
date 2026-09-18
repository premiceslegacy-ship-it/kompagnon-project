-- ============================================================
-- 191 — match_company_memory accepte un filtre optionnel chantier_id
-- ------------------------------------------------------------
-- Prépare la mémoire persistante de Marco (chef de chantier virtuel) :
-- un souvenir peut être scopé à UN chantier précis
-- (metadata->>'chantier_id' rempli) ou global à l'entreprise
-- (metadata->>'chantier_id' absent/null).
--
-- Quand p_chantier_id est fourni, la fonction retourne l'UNION des
-- souvenirs scopés à ce chantier ET des souvenirs globaux entreprise —
-- pas une isolation stricte : un pattern appris sur un chantier
-- ("le sous-traitant Dupont dépasse souvent le budget") doit rester
-- utile ailleurs, tandis qu'un souvenir propre à un chantier précis
-- ne doit pas polluer les autres.
--
-- Signature étendue mais rétrocompatible : p_chantier_id est optionnel
-- (défaut NULL = comportement inchangé pour Sarah, qui ne le passe pas).
-- ============================================================

CREATE OR REPLACE FUNCTION match_company_memory(
  p_organization_id uuid,
  p_embedding float[],
  p_limit int DEFAULT 5,
  p_activity_id text DEFAULT NULL,  -- filtre optionnel sur metadata->>'activity_id'
  p_chantier_id text DEFAULT NULL   -- filtre optionnel : chantier précis OU global si NULL sur la ligne
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
      AND (
        p_chantier_id IS NULL
        OR cm.metadata->>'chantier_id' = p_chantier_id
        OR cm.metadata->>'chantier_id' IS NULL
      )
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
