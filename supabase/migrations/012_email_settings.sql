-- Migration 011 : Paramètres email par organisation
-- Permet à chaque client de configurer son expéditeur email (via Resend).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS email_from_name    TEXT,
  ADD COLUMN IF NOT EXISTS email_from_address TEXT;

COMMENT ON COLUMN organizations.email_from_name    IS 'Nom d''affichage de l''expéditeur (ex: Dupont BTP)';
COMMENT ON COLUMN organizations.email_from_address IS 'Adresse email expéditeur vérifiée sur Resend (ex: contact@dupont-btp.fr)';
