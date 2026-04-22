-- Migration 038 — Agent WhatsApp IA
-- Configuration webhook WhatsApp par organisation + log des messages

-- ─── Table de configuration WhatsApp ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_configs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number_id     TEXT        NOT NULL,     -- ID du numéro Meta (Phone Number ID)
  waba_id             TEXT,                     -- WhatsApp Business Account ID
  access_token        TEXT        NOT NULL,     -- Token d'accès permanent Meta
  verify_token        TEXT        NOT NULL,     -- Token aléatoire pour la vérification webhook
  authorized_numbers  TEXT[]      DEFAULT '{}', -- Numéros autorisés à utiliser l'agent (format E.164)
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id)   -- 1 config WhatsApp par org
);

-- ─── Table de log des messages WhatsApp ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wamid             TEXT,                       -- ID WhatsApp du message entrant
  direction         TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number       TEXT        NOT NULL,
  to_number         TEXT        NOT NULL,
  message_type      TEXT,                       -- 'text' | 'audio' | 'image'
  transcription     TEXT,                       -- Résultat STT si message vocal
  content           TEXT,                       -- Texte du message
  tool_calls        JSONB,                      -- Appels outils Claude (pour debug)
  error             TEXT,                       -- Erreur éventuelle
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_org
  ON whatsapp_configs(organization_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_phone
  ON whatsapp_configs(phone_number_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_org
  ON whatsapp_messages(organization_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from
  ON whatsapp_messages(from_number, created_at DESC);

-- ─── Trigger updated_at ───────────────────────────────────────────────────────

SELECT create_updated_at_trigger('whatsapp_configs');

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE whatsapp_configs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- whatsapp_configs : lecture + écriture réservées à l'owner/admin
CREATE POLICY "whatsapp_configs_select" ON whatsapp_configs
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "whatsapp_configs_insert" ON whatsapp_configs
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
    AND user_has_permission('settings.edit')
  );

CREATE POLICY "whatsapp_configs_update" ON whatsapp_configs
  FOR UPDATE USING (
    organization_id = get_user_org_id()
    AND user_has_permission('settings.edit')
  );

CREATE POLICY "whatsapp_configs_delete" ON whatsapp_configs
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND user_has_permission('settings.edit')
  );

-- whatsapp_messages : lecture par les membres de l'org
CREATE POLICY "whatsapp_messages_select" ON whatsapp_messages
  FOR SELECT USING (organization_id = get_user_org_id());

-- INSERT autorisé uniquement via service role (Edge Function) → pas de policy INSERT
