-- Fonction de recherche vectorielle pour le RAG company_memory
-- Accepte float[] pour compatibilité avec le SDK Supabase JS (pas de type vector natif côté client)
-- SECURITY DEFINER : filtre par organization_id en interne, pas besoin de RLS

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
  SELECT
    content,
    type,
    metadata,
    1 - (embedding <=> p_embedding::public.vector(4096)) AS similarity
  FROM public.company_memory
  WHERE organization_id = p_organization_id
    AND is_active = true
    AND embedding IS NOT NULL
    AND (p_activity_id IS NULL OR metadata->>'activity_id' = p_activity_id)
  ORDER BY embedding <=> p_embedding::public.vector(4096)
  LIMIT p_limit;
$$;
