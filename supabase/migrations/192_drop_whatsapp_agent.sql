-- ============================================================
-- 192 — Retrait de l'agent WhatsApp
-- ------------------------------------------------------------
-- WhatsApp est abandonné comme feature (décision du 2026-09-16) : la fonction
-- Edge whatsapp-webhook, l'onglet de réglages et le code applicatif sont
-- supprimés. Cette migration retire les tables et les anciens drapeaux.
--
-- Vérifié avant application (2026-10-02) : whatsapp_messages vide,
-- whatsapp_configs = 1 ligne de test, aucune clé étrangère entrante, aucune
-- fonction SQL dédiée.
--
-- Les policies, index, contraintes et triggers des deux tables disparaissent
-- avec elles. Idempotente.
-- ============================================================

DROP TABLE IF EXISTS public.whatsapp_messages;
DROP TABLE IF EXISTS public.whatsapp_configs;

-- Anciennes clés de modules : le code les ignore déjà, on nettoie les données.
UPDATE public.organization_modules
SET modules = modules - 'whatsapp_agent' - 'whatsapp_ocr' - 'whatsapp_proactive'
WHERE modules ?| ARRAY['whatsapp_agent', 'whatsapp_ocr', 'whatsapp_proactive'];
