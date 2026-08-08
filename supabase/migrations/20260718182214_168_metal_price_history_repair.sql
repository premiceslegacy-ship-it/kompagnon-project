-- Réparation idempotente de la migration 168 (metal_price_history) appliquée directement sur le distant
-- lors du déploiement du 18/07/2026. Miroir local pour aligner l'historique des migrations.
-- Entièrement IF NOT EXISTS : ne fait rien si la table existe déjà.

CREATE TABLE IF NOT EXISTS public.metal_price_history (
  metal_code    TEXT        NOT NULL CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'NI')),
  price_date    DATE        NOT NULL,
  price_eur_kg  DECIMAL(10, 4) NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'atelier_market_data',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (metal_code, price_date)
);

COMMENT ON TABLE public.metal_price_history IS
  'Historique quotidien des cours LME (une ligne par métal et par jour, dernier cours du jour écrase les précédents). Sert au calcul de variation/tendance affiché dans la bannière prix matières.';

CREATE INDEX IF NOT EXISTS idx_metal_price_history_code_date
  ON public.metal_price_history(metal_code, price_date DESC);

ALTER TABLE public.metal_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.metal_price_history FROM anon;
REVOKE ALL ON TABLE public.metal_price_history FROM authenticated;
