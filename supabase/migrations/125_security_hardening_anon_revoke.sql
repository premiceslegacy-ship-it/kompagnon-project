-- Révocation EXECUTE pour le rôle anon sur les fonctions non publiques.
-- Aucune de ces fonctions n'est appelée via l'API sans authentification :
-- les triggers sont invoqués par Postgres, les fonctions métier par createClient()
-- (utilisateur connecté) ou createAdminClient() (service role).
-- Le rôle authenticated conserve ses droits EXECUTE inchangés.

-- Triggers internes — jamais appelés via RPC
REVOKE EXECUTE ON FUNCTION public.auto_set_invoice_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_set_quote_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_init() FROM anon;
REVOKE EXECUTE ON FUNCTION public.initialize_organization_for_user(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_join_code() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_prestation_type_totals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_maintenance_contracts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_client_totals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_client_totals_from_invoice() FROM anon;

-- Fonctions métier — appelées uniquement par des utilisateurs connectés ou le service role
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_quote_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_company_memory(uuid, double precision[], integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(text) FROM anon;
