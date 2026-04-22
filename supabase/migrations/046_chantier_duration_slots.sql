-- Stockage de durées multiples par passage (plurihebdomadaire avec durées différentes)
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS recurrence_duration_slots JSONB;
