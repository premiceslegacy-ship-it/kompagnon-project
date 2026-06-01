-- Structured quote item fields for AI-generated drafts.
-- Backwards compatible: legacy `description` remains the canonical fallback.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS ai_source TEXT,
  ADD COLUMN IF NOT EXISTS ai_warnings TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.quote_items.designation IS
  'Short customer-facing line title/designation. Legacy rows may keep this null and use description.';
COMMENT ON COLUMN public.quote_items.details IS
  'Optional line details/inclusions shown below the designation.';
COMMENT ON COLUMN public.quote_items.ai_confidence IS
  'AI confidence score between 0 and 1 for generated/imported quote lines.';
COMMENT ON COLUMN public.quote_items.ai_source IS
  'AI pricing/source hint: catalog, recent_quote, memory, client_input, ai_estimate, document.';
COMMENT ON COLUMN public.quote_items.ai_warnings IS
  'AI warnings for uncertain quantities, prices, client matching or document extraction.';
