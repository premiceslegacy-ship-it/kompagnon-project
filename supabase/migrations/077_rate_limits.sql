-- 077_rate_limits.sql
-- Atomic per-instance rate limits for public forms and AI routes.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  scope TEXT NOT NULL,
  identifier_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, identifier_hash, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
  ON public.rate_limits(updated_at);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_scope TEXT,
  p_identifier_hash TEXT,
  p_limit INTEGER,
  p_window_start TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_limit <= 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.rate_limits
  WHERE updated_at < now() - INTERVAL '7 days';

  INSERT INTO public.rate_limits (scope, identifier_hash, window_start, count, updated_at)
  VALUES (p_scope, p_identifier_hash, p_window_start, 1, now())
  ON CONFLICT (scope, identifier_hash, window_start)
  DO UPDATE SET
    count = public.rate_limits.count + 1,
    updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO service_role;
