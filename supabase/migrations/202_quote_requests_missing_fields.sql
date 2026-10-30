-- These fields are read by the request inbox and written by the public form,
-- but were absent from the versioned schema. Keep historical attachment URLs
-- for authenticated resolution to private storage; new uploads store metadata.
ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS prestation_type TEXT,
  ADD COLUMN IF NOT EXISTS dimensions TEXT,
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;

NOTIFY pgrst, 'reload schema';
