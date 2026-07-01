-- Migration 145 : email broadcasts (envois groupés clients)
-- Table des campagnes d'envoi email
CREATE TABLE IF NOT EXISTS email_broadcasts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  body_html        TEXT NOT NULL,
  recipient_filter JSONB NOT NULL DEFAULT '{}',
  -- ex: { "statuses": ["active","prospect"], "ids": null }
  recipient_count  INT NOT NULL DEFAULT 0,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id)
);

-- Table des logs d'envoi par destinataire (traçabilité RGPD)
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id   UUID NOT NULL REFERENCES email_broadcasts(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'sent',
  -- 'sent' | 'error'
  error_message  TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_email_broadcasts_org ON email_broadcasts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_broadcast ON broadcast_logs(broadcast_id);

-- RLS
ALTER TABLE email_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_broadcasts" ON email_broadcasts
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM memberships WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_broadcast_logs" ON broadcast_logs
  FOR ALL USING (
    broadcast_id IN (
      SELECT id FROM email_broadcasts
      WHERE organization_id IN (
        SELECT organization_id FROM memberships WHERE user_id = auth.uid()
      )
    )
  );
