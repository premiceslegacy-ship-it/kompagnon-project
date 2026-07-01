-- Variantes / options de devis (Version A acier / Version B inox, option pose, etc.)
-- Deux colonnes sur quotes :
--   variant_group_id : UUID partagé entre les variantes d'un même devis (NULL = pas de variante)
--   variant_label    : libellé libre de cette variante ("Version A — Acier", "Option pose complète")

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS variant_group_id uuid NULL,
  ADD COLUMN IF NOT EXISTS variant_label     text NULL;

COMMENT ON COLUMN public.quotes.variant_group_id IS
  'UUID partagé entre toutes les variantes d''un même devis. NULL si ce devis n''a pas de variante.';
COMMENT ON COLUMN public.quotes.variant_label IS
  'Libellé de cette variante (ex: "Version A — Acier", "Option sans pose"). Affiché dans l''éditeur et la liste des finances.';

CREATE INDEX IF NOT EXISTS idx_quotes_variant_group
  ON public.quotes (organization_id, variant_group_id)
  WHERE variant_group_id IS NOT NULL;
