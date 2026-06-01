-- Option d'envoi automatique des factures récurrentes liées aux contrats d'entretien.
-- NULL = validation manuelle, sinon délai en jours après préparation du brouillon.
ALTER TABLE public.maintenance_contracts
  ADD COLUMN IF NOT EXISTS auto_send_delay_days INTEGER;

COMMENT ON COLUMN public.maintenance_contracts.auto_send_delay_days IS
  'Nombre de jours après préparation du brouillon avant envoi automatique. NULL = validation manuelle.';

UPDATE public.maintenance_contracts mc
SET auto_send_delay_days = ri.auto_send_delay_days
FROM public.recurring_invoices ri
WHERE mc.recurring_invoice_id = ri.id
  AND mc.auto_send_delay_days IS NULL
  AND ri.auto_send_delay_days IS NOT NULL;
