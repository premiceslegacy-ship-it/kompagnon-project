-- Réparation : deux contraintes UNIQUE définies dans 001_operator_usage.sql
-- avaient disparu de la base réelle (ghkacozmtvvmlbbwwnlp), constaté le
-- 2026-09-09. Root cause non confirmée avec certitude, mais la fenêtre la
-- plus probable est l'exécution de 009_multi_org_per_instance.sql
-- (2026-08-08), qui manipule des contraintes sur des tables adjacentes
-- (operator_client_settings, operator_client_subscriptions, operator_client_quotas)
-- sans toucher explicitement à operator_clients ni operator_usage_events —
-- ces deux tables ont pu être affectées par une opération manuelle annexe
-- au même moment, non tracée dans une migration versionnée.
--
-- Conséquence observée : tout upsert applicatif utilisant
-- ON CONFLICT (source_instance, organization_id) sur operator_clients, ou
-- ON CONFLICT (source_instance, local_usage_log_id) sur operator_usage_events,
-- échouait silencieusement côté ingestion (erreur Postgres 42P10, absorbée
-- par le pattern "best effort" de synchronisation). Résultat visible : coût
-- IA à 0 euros pour tous les clients dans /orsayn depuis fin juillet 2026,
-- malgré des usage_logs corrects en local sur chaque instance cliente.
--
-- Appliquée directement dans le SQL Editor du dashboard Supabase le
-- 2026-09-09 sur ghkacozmtvvmlbbwwnlp, hors CLI (cockpit non lié au projet
-- de ce repo). Ce fichier documente le correctif a posteriori pour qu'une
-- recréation future du cockpit (couche A du provisioning, voir
-- docs/souverainete-donnees/ en local) parte d'un schéma correct sans
-- redécouvrir ce bug.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operator_clients_source_instance_org_unique'
  ) THEN
    ALTER TABLE public.operator_clients
      ADD CONSTRAINT operator_clients_source_instance_org_unique
      UNIQUE (source_instance, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operator_usage_events_source_log_unique'
  ) THEN
    ALTER TABLE public.operator_usage_events
      ADD CONSTRAINT operator_usage_events_source_log_unique
      UNIQUE (source_instance, local_usage_log_id);
  END IF;
END $$;
