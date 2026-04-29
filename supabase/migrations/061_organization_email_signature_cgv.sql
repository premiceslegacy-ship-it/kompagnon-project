-- Champs complémentaires pour les emails et documents
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email_signature      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS cgv_text             TEXT    NULL,
  ADD COLUMN IF NOT EXISTS reminder_first_delay_days  INT NULL DEFAULT 2;
