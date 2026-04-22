-- ============================================================
-- 036_quote_requests_v2.sql
-- Formulaire public v2 : type catalogue + sur-mesure, fichiers joints
-- Paramètres formulaire public sur organizations
-- ============================================================

-- ----------------------------------------------------------
-- quote_requests : nouvelles colonnes v2
-- ----------------------------------------------------------
ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'custom',
  -- 'catalog' | 'custom'
  ADD COLUMN IF NOT EXISTS catalog_items JSONB,
  -- [{ id, item_type: 'material'|'labor', description, quantity, unit, unit_price }]
  ADD COLUMN IF NOT EXISTS attachments JSONB;
  -- [{ storage_path, filename, size }]

-- ----------------------------------------------------------
-- organizations : paramètres du formulaire public
-- ----------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS public_form_enabled             BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_form_welcome_message     TEXT,
  ADD COLUMN IF NOT EXISTS public_form_catalog_item_ids    JSONB    DEFAULT '[]'::jsonb,
  -- ex: [{ "id": "uuid", "item_type": "material" }, ...]
  ADD COLUMN IF NOT EXISTS public_form_custom_mode_enabled BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_form_notification_email  TEXT;
