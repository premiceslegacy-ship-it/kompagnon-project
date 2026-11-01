-- Disposable LOCAL cockpit DB only, migrations 001-023. All fixtures roll back.
BEGIN;
SET LOCAL ROLE service_role;
DO $onboarding$
DECLARE
  eligible_org UUID := gen_random_uuid();
  subscription_org UUID := gen_random_uuid();
  current_revision INTEGER;
  affected_rows INTEGER;
  stored_actor TEXT;
  stored_validated_at TIMESTAMPTZ;
  original_attestation_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.operator_clients (source_instance, organization_id, label)
    VALUES ('atelier-app', eligible_org, 'Fictional onboarding client'),
      ('atelier-app', subscription_org, 'Fictional non-setup client');
  INSERT INTO public.operator_client_settings (source_instance, organization_id, label, app_url)
    VALUES ('atelier-app', eligible_org, 'Fictional onboarding client', 'https://app.atelier-btp.fr'),
      ('atelier-app', subscription_org, 'Fictional non-setup client', 'https://app.atelier-btp.fr');
  INSERT INTO public.operator_client_subscriptions (source_instance, organization_id)
    VALUES ('atelier-app', eligible_org), ('atelier-app', subscription_org);

  -- Isolated fixture of the setup billing state; never invoke payment approval here.
  UPDATE public.operator_client_subscriptions
    SET billing_model = 'setup', tier = 'setup_only', ai_billing_mode = 'client_owned',
      mrr_ht = 0, access_status = 'active', trial_converted = true
    WHERE source_instance = 'atelier-app' AND organization_id = eligible_org;

  INSERT INTO public.operator_setup_client_onboarding (
    source_instance, organization_id, first_value_goal, first_value_acceptance,
    scope_included, scope_excluded, decision_owner_role, expected_materials,
    blockers, next_action, created_by, updated_by
  ) VALUES (
    'atelier-app', eligible_org, 'Préparer un devis de chantier à relire.',
    'Le client valide le prix et les postes.', 'Un modèle de devis et un exemple relu.',
    'Aucun envoi automatique au client.', 'Dirigeant',
    '[{"label":"Photos de chantier","category":"photo","count":3,"reference":"chantier-2026-04"}]'::JSONB,
    'Aucune donnée source reçue.', 'Confirmer le format du devis.',
    'operator@example.invalid', 'operator@example.invalid'
  ) RETURNING revision INTO current_revision;

  IF current_revision <> 1 THEN
    RAISE EXCEPTION 'Initial setup intake revision was not 1';
  END IF;

  UPDATE public.operator_setup_client_onboarding SET next_action = 'Relire le format du devis.', updated_by = 'operator@example.invalid'
    WHERE source_instance = 'atelier-app' AND organization_id = eligible_org AND revision = current_revision;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN RAISE EXCEPTION 'Current setup intake revision was not updated'; END IF;

  UPDATE public.operator_setup_client_onboarding SET next_action = 'Stale overwrite.', updated_by = 'operator@example.invalid'
    WHERE source_instance = 'atelier-app' AND organization_id = eligible_org AND revision = current_revision;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN RAISE EXCEPTION 'A stale setup intake revision overwrote current data'; END IF;

  UPDATE public.operator_setup_client_onboarding SET scope_validated = true, updated_by = 'operator@example.invalid'
    WHERE source_instance = 'atelier-app' AND organization_id = eligible_org AND revision = current_revision + 1;
  SELECT scope_validated_by, scope_validated_at INTO stored_actor, stored_validated_at
    FROM public.operator_setup_client_onboarding WHERE source_instance = 'atelier-app' AND organization_id = eligible_org;
  IF stored_actor <> 'operator@example.invalid' OR stored_validated_at IS NULL THEN
    RAISE EXCEPTION 'Human scope attestation attribution was not stamped';
  END IF;
  original_attestation_at := stored_validated_at;
  UPDATE public.operator_setup_client_onboarding SET next_action = 'Préparer la revue.', updated_by = 'second-operator@example.invalid'
    WHERE source_instance = 'atelier-app' AND organization_id = eligible_org AND revision = current_revision + 2;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN RAISE EXCEPTION 'A non-scope update did not preserve the current revision'; END IF;
  SELECT scope_validated_by, scope_validated_at INTO stored_actor, stored_validated_at
    FROM public.operator_setup_client_onboarding WHERE source_instance = 'atelier-app' AND organization_id = eligible_org;
  IF stored_actor <> 'operator@example.invalid' OR stored_validated_at IS DISTINCT FROM original_attestation_at THEN
    RAISE EXCEPTION 'A non-scope update changed the human scope attestation';
  END IF;


  BEGIN
    INSERT INTO public.operator_setup_client_onboarding (source_instance, organization_id, created_by, updated_by)
      VALUES ('atelier-app', subscription_org, 'operator@example.invalid', 'operator@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'A non-setup subscription created an onboarding dossier';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'A non-setup subscription created an onboarding dossier' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.operator_setup_client_onboarding
      SET expected_materials = '[{"label":"Bad category","category":"other","count":1,"reference":""}]'::JSONB
      WHERE source_instance = 'atelier-app' AND organization_id = eligible_org;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'An invalid material category was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.operator_setup_client_onboarding
      SET expected_materials = '[{"label":"Document attendu","category":"document","count":1,"reference":"/tmp/client.pdf"}]'::JSONB
      WHERE source_instance = 'atelier-app' AND organization_id = eligible_org;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'A material path reference was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;


  IF NOT has_table_privilege('service_role', 'public.operator_setup_client_onboarding', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.operator_setup_client_onboarding', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.operator_setup_client_onboarding', 'UPDATE')
     OR has_table_privilege('service_role', 'public.operator_setup_client_onboarding', 'DELETE')
     OR has_table_privilege('anon', 'public.operator_setup_client_onboarding', 'SELECT')
     OR has_table_privilege('authenticated', 'public.operator_setup_client_onboarding', 'INSERT')
     OR NOT (SELECT c.relrowsecurity FROM pg_class AS c WHERE c.oid = 'public.operator_setup_client_onboarding'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operator_setup_client_onboarding') THEN
    RAISE EXCEPTION 'Setup intake grants are not service-role-only';
  END IF;
END;
$onboarding$;
RESET ROLE;
ROLLBACK;
