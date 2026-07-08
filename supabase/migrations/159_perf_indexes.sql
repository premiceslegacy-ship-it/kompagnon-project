-- ============================================================
-- 159 — Index de performance (audit perf juillet 2026)
-- ------------------------------------------------------------
-- Le tri par created_at (finances, catalogue) et la recherche par
-- fenêtre de dates (planning) reposaient sur des index qui ne
-- couvraient pas la colonne de tri/filtre effectivement utilisée
-- par les requêtes. Sans cet index composite, Postgres doit trier
-- en mémoire (sort) au lieu de lire les lignes déjà dans l'ordre.
-- Ajout non-bloquant (CONCURRENTLY hors transaction de migration
-- standard : Supabase applique les migrations dans une transaction,
-- CREATE INDEX classique reste donc utilisé ici comme le reste du repo).
-- ============================================================

-- Catalogue : tri par created_at desc dans getMaterials()/getLaborRates()
CREATE INDEX IF NOT EXISTS idx_materials_org_active_created
  ON public.materials(organization_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_labor_rates_org_active_created
  ON public.labor_rates(organization_id, is_active, created_at DESC);

-- Finances : tri par created_at desc, filtré sur is_archived=false (getQuotes/getInvoices)
CREATE INDEX IF NOT EXISTS idx_quotes_org_created_active
  ON public.quotes(organization_id, created_at DESC) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_invoices_org_created_active
  ON public.invoices(organization_id, created_at DESC) WHERE is_archived = false;

-- Planning : getAllPlannings() filtre par fenêtre de dates (planned_date) après
-- join sur chantiers.organization_id. chantier_plannings n'a pas de colonne
-- organization_id directe ; l'index existant (chantier_id, planned_date) couvre
-- déjà le filtre par date une fois le join fait — pas d'index supplémentaire requis ici.
