-- Migration 017 — Relances automatiques par organisation
-- Ajoute la configuration des relances automatiques (cron Vercel).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS auto_reminder_enabled  BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_reminder_days  JSONB     DEFAULT '[2, 7]'::jsonb,
  ADD COLUMN IF NOT EXISTS quote_reminder_days    JSONB     DEFAULT '[3, 10]'::jsonb;

COMMENT ON COLUMN organizations.auto_reminder_enabled  IS 'Active les relances automatiques par email (cron quotidien)';
COMMENT ON COLUMN organizations.invoice_reminder_days  IS 'Jours après échéance pour relancer les factures impayées (ex: [2, 7])';
COMMENT ON COLUMN organizations.quote_reminder_days    IS 'Jours après envoi pour relancer les devis sans réponse (ex: [3, 10])';
