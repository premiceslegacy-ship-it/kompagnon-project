ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS default_retention_pct numeric(4,2) DEFAULT 0;
