-- Ajoute le délai d'envoi automatique des factures récurrentes.
-- NULL = envoi automatique désactivé, sinon nombre de jours après notification.
ALTER TABLE public.recurring_invoices
  ADD COLUMN IF NOT EXISTS auto_send_delay_days INTEGER;

COMMENT ON COLUMN public.recurring_invoices.auto_send_delay_days IS
  'Nombre de jours après création du brouillon avant envoi automatique. NULL désactive l''envoi automatique.';
