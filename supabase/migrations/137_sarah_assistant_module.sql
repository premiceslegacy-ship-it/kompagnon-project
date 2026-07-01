-- Migration 137 : module sarah_assistant
--
-- Sépare "Assistant chantier IA" (assistant inline fiche chantier, Starter+)
-- de "Sarah — secrétaire métier" (widget global, Pro+).
--
-- La colonne quota_config et modules sont stockées en JSONB dans organization_modules.
-- Cette migration ajoute la clé sarah_assistant dans les configs existantes
-- en conservant les valeurs déjà en place pour chantier_assistant.

-- Ajouter sarah_assistant dans modules (false par défaut pour tous les clients existants)
-- Le cockpit poussera la vraie valeur selon le tier via config-sync.
UPDATE organization_modules
SET modules = modules || jsonb_build_object('sarah_assistant', false)
WHERE modules IS NOT NULL
  AND NOT (modules ? 'sarah_assistant');

-- Ajouter sarah_assistant dans quota_config (0 par défaut)
UPDATE organization_modules
SET quota_config = quota_config || jsonb_build_object('sarah_assistant', 0)
WHERE quota_config IS NOT NULL
  AND NOT (quota_config ? 'sarah_assistant');

-- Pour les orgs sans organization_modules (ne devrait pas arriver mais par sécurité)
-- => rien à faire, la ligne sera créée au prochain config-sync ou déploiement.
