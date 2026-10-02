-- ============================================================
-- 017 — Retrait du suivi des coûts WhatsApp (cockpit)
-- ------------------------------------------------------------
-- WhatsApp est abandonné comme feature (décision du 2026-09-16).
-- - operator_whatsapp_cost_snapshots (coûts Twilio/WABA) n'est plus alimentée
--   ni lue par le code : suppression de la table.
-- - Les quotas mensuels wa_* / whatsapp_ocr n'existent plus dans le catalogue :
--   suppression de leurs lignes dans operator_client_quotas.
--
-- Conservé volontairement : l'historique de consommation (operator_usage_events,
-- operator_quota_usage_events). Il sert aux marges et aux coûts passés ; le
-- cockpit affiche ces lignes sous « Autre consommation IA ».
-- Idempotente.
-- ============================================================

DROP TABLE IF EXISTS public.operator_whatsapp_cost_snapshots;

DELETE FROM public.operator_client_quotas
WHERE quota_feature IN ('wa_messages', 'wa_vocal_minutes', 'wa_proactive_messages', 'whatsapp_ocr');
