-- ============================================================
-- 140_voice_live_module.sql
--
-- Ajoute le module voice_live dans les configs existantes.
-- Pro et Expert l'auront activé via config-sync cockpit.
-- Par défaut false pour tous les clients existants.
-- ============================================================

UPDATE organization_modules
SET modules = modules || jsonb_build_object('voice_live', false)
WHERE modules IS NOT NULL
  AND NOT (modules ? 'voice_live');

UPDATE organization_modules
SET quota_config = quota_config || jsonb_build_object('voice_live_minutes', 0)
WHERE quota_config IS NOT NULL
  AND NOT (quota_config ? 'voice_live_minutes');
