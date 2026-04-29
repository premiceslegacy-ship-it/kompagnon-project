-- Migration 060 : Workflow de suppression de compte RGPD
-- Ajoute les colonnes de soft-delete sur organizations.
-- La purge hard se fait via cron 30j après deletion_requested_at.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.organizations.deletion_requested_at IS 'Date à laquelle l''owner a demandé la suppression (soft-delete step 1).';
COMMENT ON COLUMN public.organizations.deletion_scheduled_at IS 'Date de purge définitive programmée (deletion_requested_at + 30j).';
