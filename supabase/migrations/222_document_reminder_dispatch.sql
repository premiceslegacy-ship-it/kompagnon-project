BEGIN;

-- Reserve before contacting the provider: a unique log inserted after sending
-- cannot prevent two workers from sending the same reminder.
CREATE TABLE public.document_reminder_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE CASCADE,
  dispatch_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Paris')::DATE,
  delivery TEXT NOT NULL DEFAULT 'pending' CHECK (delivery IN ('pending', 'accepted', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(invoice_id, quote_id) = 1)
);
CREATE UNIQUE INDEX document_reminder_invoice_day ON public.document_reminder_dispatches(invoice_id, dispatch_date) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX document_reminder_quote_day ON public.document_reminder_dispatches(quote_id, dispatch_date) WHERE quote_id IS NOT NULL;
ALTER TABLE public.document_reminder_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_reminder_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_reminder_dispatches TO service_role;

CREATE FUNCTION public.claim_document_reminder(p_org_id UUID, p_invoice_id UUID DEFAULT NULL, p_quote_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_day DATE := (now() AT TIME ZONE 'Europe/Paris')::DATE;
  v_invoice public.invoices%ROWTYPE;
  v_credited_ttc NUMERIC(12,2);
BEGIN
  IF num_nonnulls(p_invoice_id, p_quote_id) <> 1 THEN
    RAISE EXCEPTION 'Exactly one reminder document is required' USING ERRCODE = '22023';
  END IF;
  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.invoices
    WHERE id = p_invoice_id AND organization_id = p_org_id AND status IN ('sent', 'viewed', 'partial', 'overdue')
    FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.quotes
    WHERE id = p_quote_id AND organization_id = p_org_id AND status IN ('sent', 'viewed')
    FOR UPDATE;
  END IF;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id AND anonymized_at IS NULL AND deletion_scheduled_at IS NULL) THEN
    RAISE EXCEPTION 'Reminder document is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NOT NULL THEN
    v_credited_ttc := public.invoice_credited_ttc_v221(p_org_id, p_invoice_id);
    IF ROUND(COALESCE(v_invoice.total_ttc, 0) - COALESCE(v_invoice.total_paid, 0) - v_credited_ttc, 2) <= 0 THEN
      RAISE EXCEPTION 'Cette facture est soldée ou compensée par un avoir.' USING ERRCODE = 'P2001';
    END IF;
  END IF;
  -- Honor earlier deliveries, including manual reminders and legacy workers.
  IF EXISTS (
    SELECT 1 FROM public.reminders
    WHERE organization_id = p_org_id
      AND ((p_invoice_id IS NOT NULL AND invoice_id = p_invoice_id) OR (p_quote_id IS NOT NULL AND quote_id = p_quote_id))
      AND (COALESCE(sent_at, created_at) AT TIME ZONE 'Europe/Paris')::DATE = v_day
  ) OR EXISTS (
    SELECT 1 FROM public.document_reminder_dispatches
    WHERE organization_id = p_org_id
      AND ((p_invoice_id IS NOT NULL AND invoice_id = p_invoice_id) OR (p_quote_id IS NOT NULL AND quote_id = p_quote_id))
      AND (dispatch_date = v_day OR delivery IN ('pending', 'unknown'))
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.document_reminder_dispatches(organization_id, invoice_id, quote_id, dispatch_date)
  VALUES (p_org_id, p_invoice_id, p_quote_id, v_day)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_document_reminder(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_reminder(UUID, UUID, UUID) TO service_role;
COMMENT ON TABLE public.document_reminder_dispatches IS 'Pre-send claims shared by manual and scheduled document reminders. Pending/unknown delivery is never automatically retried; verify provider delivery before resolving it.';
NOTIFY pgrst, 'reload schema';
COMMIT;
