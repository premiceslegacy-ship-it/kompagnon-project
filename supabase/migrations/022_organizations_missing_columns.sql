ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email_from_name    TEXT,
  ADD COLUMN IF NOT EXISTS email_from_address TEXT,
  ADD COLUMN IF NOT EXISTS reminder_hour_utc  INT DEFAULT 8;
