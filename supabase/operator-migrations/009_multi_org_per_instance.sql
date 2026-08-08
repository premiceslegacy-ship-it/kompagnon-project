-- Support de plusieurs organisations par source_instance (SaaS mutualisé).
-- Contexte : operator_client_settings et operator_client_subscriptions avaient
-- source_instance comme clé primaire SEULE — une instance mutualisée portant
-- N organisations (ex. pyxnmohknxmbpbcuvudg avec 6 orgs) les écrasait toutes
-- en une seule ligne cockpit, avec un seul tier/quota partagé. operator_clients
-- avait déjà la bonne contrainte UNIQUE(source_instance, organization_id) ;
-- cette migration aligne les autres tables dessus.
-- Toutes les tables concernées étaient vides au moment de cette migration
-- (2026-08-08, vérifié) : NOT NULL direct sans DEFAULT temporaire, pas de backfill.
-- Appliquée directement sur ghkacozmtvvmlbbwwnlp via `supabase db query --file`
-- (accès isolé par SUPABASE_ACCESS_TOKEN dédié, hors du lien CLI du repo app).

-- ─── 0. Retirer toutes les FK qui dépendent de la PK simple de settings ───
-- (nécessaire avant de pouvoir DROP CONSTRAINT ... _pkey plus bas)
ALTER TABLE public.operator_quota_usage_events
  DROP CONSTRAINT IF EXISTS operator_quota_usage_events_source_instance_fkey;
ALTER TABLE public.operator_client_subscriptions
  DROP CONSTRAINT IF EXISTS operator_client_subscriptions_source_instance_fkey;
ALTER TABLE public.operator_client_quotas
  DROP CONSTRAINT IF EXISTS operator_client_quotas_source_instance_fkey;
ALTER TABLE public.operator_client_events
  DROP CONSTRAINT IF EXISTS operator_client_events_source_instance_fkey;
ALTER TABLE public.operator_commercial_events
  DROP CONSTRAINT IF EXISTS operator_commercial_events_source_instance_fkey;

-- ─── 1. operator_client_settings : PK composite ───
ALTER TABLE public.operator_client_settings
  ADD COLUMN organization_id UUID NOT NULL;

ALTER TABLE public.operator_client_settings
  DROP CONSTRAINT operator_client_settings_pkey;

ALTER TABLE public.operator_client_settings
  ADD CONSTRAINT operator_client_settings_pkey PRIMARY KEY (source_instance, organization_id);

-- ─── 2. operator_client_subscriptions : PK composite + FK composite vers settings ───
ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN organization_id UUID NOT NULL;

ALTER TABLE public.operator_client_subscriptions
  DROP CONSTRAINT operator_client_subscriptions_pkey;

ALTER TABLE public.operator_client_subscriptions
  ADD CONSTRAINT operator_client_subscriptions_pkey PRIMARY KEY (source_instance, organization_id);

ALTER TABLE public.operator_client_subscriptions
  ADD CONSTRAINT operator_client_subscriptions_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id)
    ON DELETE CASCADE;

-- ─── 3. operator_client_quotas : organization_id dans la contrainte d'unicité ───
ALTER TABLE public.operator_client_quotas
  ADD COLUMN organization_id UUID NOT NULL;

ALTER TABLE public.operator_client_quotas
  DROP CONSTRAINT IF EXISTS operator_client_quotas_source_instance_quota_feature_perio_key;
ALTER TABLE public.operator_client_quotas
  DROP CONSTRAINT IF EXISTS operator_client_quotas_unique;

ALTER TABLE public.operator_client_quotas
  ADD CONSTRAINT operator_client_quotas_unique
    UNIQUE (source_instance, organization_id, quota_feature, period_start);

ALTER TABLE public.operator_client_quotas
  ADD CONSTRAINT operator_client_quotas_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id)
    ON DELETE CASCADE;

-- ─── 4. operator_client_events / operator_commercial_events : FK composite ───
ALTER TABLE public.operator_client_events
  ADD COLUMN organization_id UUID NOT NULL;

ALTER TABLE public.operator_client_events
  ADD CONSTRAINT operator_client_events_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id)
    ON DELETE CASCADE;

ALTER TABLE public.operator_commercial_events
  ADD COLUMN organization_id UUID NOT NULL;

ALTER TABLE public.operator_commercial_events
  ADD CONSTRAINT operator_commercial_events_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id)
    ON DELETE CASCADE;

-- ─── 5. operator_quota_usage_events : pas de FK composite (journal d'events IA,
-- jamais requêté par organisation dans le code applicatif) — la FK vers
-- source_instance seul a été retirée à l'étape 0 sans être recréée, la colonne
-- source_instance reste (non-FK) pour la traçabilité brute.

-- ─── 6. event_category : autoriser 'vertical_pack' (bug latent, insert échoue en silence) ───
ALTER TABLE public.operator_client_events
  DROP CONSTRAINT IF EXISTS operator_client_events_event_category_check;

ALTER TABLE public.operator_client_events
  ADD CONSTRAINT operator_client_events_event_category_check
    CHECK (event_category IN ('subscription','trial','config_sync','einvoicing','module','crm','note','vertical_pack'));

-- ─── 7. Index pour les requêtes filtrées par organisation ───
CREATE INDEX IF NOT EXISTS idx_operator_client_subscriptions_org ON public.operator_client_subscriptions (organization_id);
CREATE INDEX IF NOT EXISTS idx_operator_client_quotas_org ON public.operator_client_quotas (organization_id);
CREATE INDEX IF NOT EXISTS idx_operator_client_events_org ON public.operator_client_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_operator_commercial_events_org ON public.operator_commercial_events (organization_id);
