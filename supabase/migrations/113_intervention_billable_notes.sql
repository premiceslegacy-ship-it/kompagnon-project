ALTER TABLE public.maintenance_interventions
  ADD COLUMN IF NOT EXISTS billable_notes TEXT;
