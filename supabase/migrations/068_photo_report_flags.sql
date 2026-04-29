-- ============================================================
-- 068_photo_report_flags.sql
-- Photos chantier : flag d'inclusion rapport PDF + traçabilité envoi client
-- Dépend de : 029_chantiers.sql
-- ============================================================

ALTER TABLE public.chantier_photos
  ADD COLUMN IF NOT EXISTS include_in_report      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_with_client_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.chantier_photos.include_in_report     IS 'Si true, la photo apparaît dans le rapport PDF client';
COMMENT ON COLUMN public.chantier_photos.shared_with_client_at IS 'Horodatage du dernier envoi de cette photo au client';

CREATE INDEX IF NOT EXISTS idx_chantier_photos_report
  ON public.chantier_photos(chantier_id, include_in_report)
  WHERE include_in_report = true;
