-- Migration 019 : Heure de relance configurable par organisation
-- Stockée en heure UTC (0–23). 8 UTC = 9h Paris hiver, 10h Paris été.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS reminder_hour_utc INT DEFAULT 8,
  ADD COLUMN IF NOT EXISTS sector TEXT;
