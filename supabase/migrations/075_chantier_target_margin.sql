-- Marge cible du chantier (en %)
-- Permet de définir un budget coûts max = budget_ht * (1 - target_margin_pct / 100)
-- afin de ne pas travailler à perte si le devis = budget = prix client.
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS target_margin_pct DECIMAL(5,2) NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.chantiers.target_margin_pct IS
  'Marge cible en % (ex: 30). Budget coûts max = budget_ht * (1 - target_margin_pct/100). Par défaut 30 %.';
