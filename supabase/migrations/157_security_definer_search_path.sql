-- ============================================================
-- 157 — search_path fixe sur les fonctions SECURITY DEFINER (correctif audit I1)
-- ------------------------------------------------------------
-- Une fonction SECURITY DEFINER s'exécute avec les droits de son propriétaire.
-- Sans SET search_path, un objet créé dans un schéma résolu à l'exécution peut
-- détourner un appel non qualifié (attaque search_path). get_user_org_id et
-- user_has_permission sont appelées dans TOUTES les policies RLS : c'est le
-- point unique de défaillance de l'isolation.
--
-- ALTER FUNCTION ... SET search_path est utilisé plutôt que de recréer les
-- corps (aucun risque de divergence avec les définitions existantes).
-- ============================================================

ALTER FUNCTION public.rls_auto_enable()                               SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_org_id()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_permission(TEXT)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_quote_number(UUID)                   SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_invoice_number(UUID)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.update_client_totals()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.initialize_organization_for_user(UUID, TEXT, TEXT) SET search_path = public, pg_temp;
