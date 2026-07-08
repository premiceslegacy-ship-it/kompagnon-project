-- Permettre l'upload de photo de chantier par un intervenant sans compte app
-- (member_id), sur le modèle de chantier_pointages (migrations 073 et 143).

ALTER TABLE public.chantier_photos
  ADD COLUMN IF NOT EXISTS member_id UUID
    REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL;

ALTER TABLE public.chantier_photos
  ALTER COLUMN uploaded_by DROP NOT NULL;

ALTER TABLE public.chantier_photos
  DROP CONSTRAINT IF EXISTS chantier_photos_who;

ALTER TABLE public.chantier_photos
  ADD CONSTRAINT chantier_photos_who
  CHECK (uploaded_by IS NOT NULL OR member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_chantier_photos_member
  ON public.chantier_photos(member_id)
  WHERE member_id IS NOT NULL;

COMMENT ON COLUMN public.chantier_photos.member_id IS
  'Auteur de la photo quand il s''agit d''un membre individuel sans compte auth (intervenant /mon-espace)';
