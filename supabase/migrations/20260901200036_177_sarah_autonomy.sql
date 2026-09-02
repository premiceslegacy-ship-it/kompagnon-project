-- Migration 177 — Autonomie limitée de Sarah pour les actions à faible risque
-- Réglage organisationnel : si actif, les actions de risque "low" proposées
-- par Sarah sont exécutées automatiquement (même chemin que la confirmation
-- manuelle, voir confirmSarahAction). Les actions medium/high restent toujours
-- soumises à confirmation humaine, quel que soit ce réglage.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sarah_auto_low_risk BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.sarah_auto_low_risk IS
  'Si true, Sarah exécute seule les actions de risque low (task_create, client_create, brief_*...) sans attendre de confirmation. Off par défaut, réglable par les owners.';
