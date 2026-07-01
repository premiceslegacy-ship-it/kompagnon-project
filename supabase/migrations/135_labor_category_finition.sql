-- Ajout de la valeur 'finition' dans la contrainte labor_category
-- Représente la sous-traitance finition : thermolaquage, galvanisation, découpe laser, etc.

ALTER TABLE public.quote_items
  DROP CONSTRAINT IF EXISTS quote_items_labor_category_check;

ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_labor_category_check
  CHECK (labor_category IN ('atelier', 'pose', 'finition', 'autre'));

COMMENT ON COLUMN public.quote_items.labor_category IS
  'Catégorie MO/sous-traitance : atelier (fab.) | pose (install.) | finition (thermolaquage, galva, découpe laser...) | autre. NULL pour lignes matière.';
