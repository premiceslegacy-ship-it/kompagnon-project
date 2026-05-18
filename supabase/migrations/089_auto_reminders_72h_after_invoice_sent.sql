-- Relances auto factures : première relance 72h après envoi, pas après échéance.

ALTER TABLE public.organizations
  ALTER COLUMN invoice_reminder_days SET DEFAULT '[3, 7]'::jsonb,
  ALTER COLUMN quote_reminder_days SET DEFAULT '[2, 7, 10]'::jsonb;

UPDATE public.organizations
SET invoice_reminder_days = '[3, 7]'::jsonb
WHERE invoice_reminder_days IS NULL
   OR invoice_reminder_days = '[2, 7]'::jsonb;

UPDATE public.organizations
SET quote_reminder_days = '[2, 7, 10]'::jsonb
WHERE quote_reminder_days IS NULL
   OR quote_reminder_days = '[3, 10]'::jsonb
   OR quote_reminder_days = '[3, 7, 10]'::jsonb;

UPDATE public.organizations
SET reminder_first_delay_days = 3
WHERE reminder_first_delay_days IS NULL
   OR reminder_first_delay_days < 3;

COMMENT ON COLUMN public.organizations.invoice_reminder_days
  IS 'Jours après envoi pour relancer les factures impayées (ex: [3, 7])';

COMMENT ON COLUMN public.organizations.quote_reminder_days
  IS 'Jours après envoi pour relancer les devis sans réponse (ex: [2, 7, 10])';

COMMENT ON COLUMN public.organizations.reminder_first_delay_days
  IS 'Délai minimum avant la première relance facture après envoi, en jours (minimum applicatif: 3).';
