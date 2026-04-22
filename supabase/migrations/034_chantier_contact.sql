-- 034_chantier_contact.sql
-- Personne référente sur un chantier (nom, email, téléphone)
-- Dépend de : 029_chantiers.sql

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

COMMENT ON COLUMN public.chantiers.contact_name  IS 'Nom de la personne référente sur le chantier';
COMMENT ON COLUMN public.chantiers.contact_email IS 'Email de la personne référente';
COMMENT ON COLUMN public.chantiers.contact_phone IS 'Téléphone de la personne référente';
