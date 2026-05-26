-- ============================================================
-- 109_chantier_periodic_billing.sql
-- Contrats longs : montant périodique, prochaine facture et
-- traçabilité des factures générées depuis un chantier.
-- ============================================================

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS montant_periode_ht      numeric(15,2),
  ADD COLUMN IF NOT EXISTS libelle_facturation_periode text,
  ADD COLUMN IF NOT EXISTS periode_facturation     text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS jour_facturation        integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS prochaine_facturation   date;

COMMENT ON COLUMN public.chantiers.montant_periode_ht IS
  'Montant HT facturé à chaque période pour un contrat long/récurrent.';
COMMENT ON COLUMN public.chantiers.libelle_facturation_periode IS
  'Libellé de la ligne créée sur la facture de période.';
COMMENT ON COLUMN public.chantiers.periode_facturation IS
  'none | mensuelle | bimestrielle | trimestrielle | annuelle';
COMMENT ON COLUMN public.chantiers.jour_facturation IS
  'Jour du mois souhaité pour la génération de facture périodique.';
COMMENT ON COLUMN public.chantiers.prochaine_facturation IS
  'Date proposée pour la prochaine facture de période.';

ALTER TABLE public.chantiers
  DROP CONSTRAINT IF EXISTS chantiers_periode_facturation_check,
  DROP CONSTRAINT IF EXISTS chantiers_jour_facturation_check;

ALTER TABLE public.chantiers
  ADD CONSTRAINT chantiers_periode_facturation_check
  CHECK (periode_facturation IN ('none', 'mensuelle', 'bimestrielle', 'trimestrielle', 'annuelle')),
  ADD CONSTRAINT chantiers_jour_facturation_check
  CHECK (jour_facturation BETWEEN 1 AND 31);

CREATE INDEX IF NOT EXISTS idx_chantiers_periodic_billing
  ON public.chantiers (organization_id, prochaine_facturation)
  WHERE periode_facturation <> 'none'
    AND montant_periode_ht IS NOT NULL
    AND montant_periode_ht > 0
    AND prochaine_facturation IS NOT NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billing_period_key text,
  ADD COLUMN IF NOT EXISTS generation_source  text;

COMMENT ON COLUMN public.invoices.billing_period_key IS
  'Clé fonctionnelle de période facturée, ex: 2026-06 ou 2026-06-01_2026-06-30.';
COMMENT ON COLUMN public.invoices.generation_source IS
  'Origine de génération : chantier_period, recurring_model, manual, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_chantier_period_generated
  ON public.invoices (organization_id, chantier_id, billing_period_key)
  WHERE generation_source = 'chantier_period'
    AND chantier_id IS NOT NULL
    AND billing_period_key IS NOT NULL
    AND status <> 'cancelled';
