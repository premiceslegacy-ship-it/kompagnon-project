-- ============================================================
-- 101_org_tva_sur_debits.sql
-- Ajout du champ tva_sur_debits sur organizations
-- Depend de : 001_organizations.sql
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS tva_sur_debits BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.tva_sur_debits IS 'TVA sur les debits (true) ou sur les encaissements (false, par defaut). Impacte le calcul TVA collectee dans les rapports et exports comptables.';
