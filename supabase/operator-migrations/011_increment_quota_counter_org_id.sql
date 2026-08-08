-- Complète les migrations 009/010 : increment_quota_counter insérait dans
-- operator_client_quotas sans organization_id (NOT NULL depuis la 009) et avec
-- un ON CONFLICT sur l'ancienne contrainte (source_instance, quota_feature,
-- period_start), qui n'existe plus (remplacée par la contrainte à 4 colonnes
-- incluant organization_id). Ajoute p_organization_id en paramètre requis.
-- operator_quota_usage_events reste volontairement sans organization_id
-- (journal d'events IA brut, jamais requêté par organisation — voir 009).
-- DROP explicite de l'ancienne signature (8 paramètres) : PostgreSQL autorise
-- la surcharge par signature, CREATE OR REPLACE seul laisserait les deux
-- fonctions coexister et l'app pourrait continuer d'appeler l'ancienne.

DROP FUNCTION IF EXISTS public.increment_quota_counter(TEXT, UUID, TEXT, TEXT, NUMERIC, NUMERIC, DATE, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.increment_quota_counter(
  p_source_instance TEXT,
  p_organization_id UUID,
  p_local_usage_log_id UUID,
  p_quota_feature TEXT,
  p_quota_unit TEXT,
  p_quantity NUMERIC,
  p_cost_eur NUMERIC,
  p_period_start DATE,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.operator_quota_usage_events (
    source_instance,
    local_usage_log_id,
    quota_feature,
    quota_unit,
    quantity,
    cost_eur,
    period_start,
    occurred_at
  )
  VALUES (
    p_source_instance,
    p_local_usage_log_id,
    p_quota_feature,
    COALESCE(p_quota_unit, 'call'),
    COALESCE(p_quantity, 1),
    COALESCE(p_cost_eur, 0),
    p_period_start,
    p_occurred_at
  )
  ON CONFLICT (source_instance, local_usage_log_id, quota_feature) DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.operator_client_quotas (
    source_instance,
    organization_id,
    quota_feature,
    quota_unit,
    quota_monthly,
    current_quantity,
    current_cost_eur,
    period_start,
    updated_at
  )
  VALUES (
    p_source_instance,
    p_organization_id,
    p_quota_feature,
    COALESCE(p_quota_unit, 'call'),
    -1,
    COALESCE(p_quantity, 1),
    COALESCE(p_cost_eur, 0),
    p_period_start,
    now()
  )
  ON CONFLICT (source_instance, organization_id, quota_feature, period_start)
  DO UPDATE SET
    quota_unit       = EXCLUDED.quota_unit,
    current_quantity = public.operator_client_quotas.current_quantity + EXCLUDED.current_quantity,
    current_cost_eur = public.operator_client_quotas.current_cost_eur + EXCLUDED.current_cost_eur,
    updated_at       = now();

  RETURN true;
END;
$$;
