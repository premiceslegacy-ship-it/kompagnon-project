-- Idempotency ledger for Super PDP submissions. A claimed request remains
-- processing when the provider outcome is ambiguous; only a definite safe
-- rejection may remove that claim and allow a retry.
CREATE TABLE IF NOT EXISTS public.operator_einvoicing_submissions (
  source_instance     TEXT        NOT NULL,
  organization_id     UUID        NOT NULL,
  invoice_id          UUID        NOT NULL,
  request_sha256      TEXT        NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  status              TEXT        NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'submitted')),
  provider_message_id TEXT,
  provider_status     TEXT,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_einvoicing_submissions_invoice_unique
    UNIQUE (source_instance, organization_id, invoice_id),
  CONSTRAINT operator_einvoicing_submissions_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id)
    ON DELETE CASCADE
);

-- Cockpit credentials only. No policy is intentionally defined; RLS denies
-- access to every role other than service_role, which also has explicit grants.
ALTER TABLE public.operator_einvoicing_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.operator_einvoicing_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operator_einvoicing_submissions TO service_role;

COMMENT ON TABLE public.operator_einvoicing_submissions IS
  'Durable per-instance and per-organization idempotency claims/results for Super PDP invoice submissions. RLS without policies: service_role only.';
COMMENT ON COLUMN public.operator_einvoicing_submissions.request_sha256 IS
  'Lowercase SHA-256 hex digest of the exact XML payload submitted to the provider.';
