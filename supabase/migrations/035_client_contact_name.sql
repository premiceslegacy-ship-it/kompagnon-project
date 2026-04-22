-- ============================================================
-- 035_client_contact_name.sql
-- Ajout d'un nom de contact référent pour les clients pros
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_name TEXT;

COMMENT ON COLUMN public.clients.contact_name IS 'Nom de la personne référente chez le client professionnel';
