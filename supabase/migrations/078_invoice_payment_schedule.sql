-- ============================================================
-- 078_invoice_payment_schedule.sql
-- Échéancier de paiement sur une facture (paiements en plusieurs fois)
-- Dépend de : 004_business_tables.sql (invoices, payments)
-- ============================================================

-- ----------------------------------------------------------
-- invoice_payment_schedule
-- Versements prévisionnels attendus sur une facture
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_payment_schedule (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id      UUID          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  label           TEXT          NOT NULL,         -- ex: "Acompte", "Échéance 2", "Solde"
  due_date        DATE          NOT NULL,          -- date de versement attendue
  amount          DECIMAL(10,2) NOT NULL,          -- montant attendu
  amount_type     TEXT          NOT NULL DEFAULT 'amount', -- 'amount' | 'percentage'
  percentage      DECIMAL(7,4),                    -- pourcentage de la facture TTC si amount_type = 'percentage'
  position        INT           NOT NULL DEFAULT 0, -- ordre d'affichage
  paid_payment_id UUID          REFERENCES public.payments(id) ON DELETE SET NULL, -- versement réel associé
  created_at      TIMESTAMPTZ   DEFAULT now(),
  updated_at      TIMESTAMPTZ   DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_payment_schedule_amount_positive'
      AND conrelid = 'public.invoice_payment_schedule'::regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_amount_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_payment_schedule_amount_type_check'
      AND conrelid = 'public.invoice_payment_schedule'::regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_amount_type_check CHECK (amount_type IN ('amount', 'percentage'));
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_payment_schedule_percentage_check'
      AND conrelid = 'public.invoice_payment_schedule'::regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_percentage_check CHECK (
        (amount_type = 'amount' AND percentage IS NULL)
        OR (amount_type = 'percentage' AND percentage > 0 AND percentage <= 100)
      );
  END IF;
END $$;

-- Index pour les lookups courants
CREATE INDEX IF NOT EXISTS idx_invoice_payment_schedule_invoice_id
  ON public.invoice_payment_schedule(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_schedule_due_date
  ON public.invoice_payment_schedule(due_date)
  WHERE paid_payment_id IS NULL; -- échéances non soldées

-- RLS
ALTER TABLE public.invoice_payment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation_invoice_payment_schedule" ON public.invoice_payment_schedule;

CREATE POLICY "invoice_payment_schedule_select"
  ON public.invoice_payment_schedule
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.view')
  );

CREATE POLICY "invoice_payment_schedule_insert"
  ON public.invoice_payment_schedule
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.edit')
  );

CREATE POLICY "invoice_payment_schedule_update"
  ON public.invoice_payment_schedule
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('invoices.edit')
      OR public.user_has_permission('invoices.record_payment')
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('invoices.edit')
      OR public.user_has_permission('invoices.record_payment')
    )
  );

CREATE POLICY "invoice_payment_schedule_delete"
  ON public.invoice_payment_schedule
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.edit')
  );

-- Cohérence org/facture/paiement, même en cas d'écriture directe hors UI.
CREATE OR REPLACE FUNCTION public.validate_invoice_payment_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_org UUID;
  payment_invoice UUID;
  payment_org UUID;
BEGIN
  SELECT organization_id INTO invoice_org
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF invoice_org IS NULL OR invoice_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'L''échéance doit appartenir à la même organisation que la facture.';
  END IF;

  IF NEW.paid_payment_id IS NOT NULL THEN
    SELECT invoice_id, organization_id INTO payment_invoice, payment_org
    FROM public.payments
    WHERE id = NEW.paid_payment_id;

    IF payment_invoice IS NULL
       OR payment_invoice <> NEW.invoice_id
       OR payment_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'Le paiement lié doit appartenir à la même facture.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER validate_invoice_payment_schedule
  BEFORE INSERT OR UPDATE ON public.invoice_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_payment_schedule();

-- updated_at automatique
CREATE OR REPLACE TRIGGER set_updated_at_invoice_payment_schedule
  BEFORE UPDATE ON public.invoice_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Encaissement atomique d'une échéance : paiement réel, lien échéance, statut facture.
CREATE OR REPLACE FUNCTION public.record_invoice_schedule_payment(
  p_invoice_id UUID,
  p_schedule_item_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_invoice RECORD;
  v_schedule RECORD;
  v_payment_id UUID;
  v_total_paid NUMERIC;
  v_status TEXT;
BEGIN
  v_org_id := public.get_user_org_id();
  v_user_id := auth.uid();

  IF v_user_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié.';
  END IF;

  IF NOT public.user_has_permission('invoices.record_payment') THEN
    RAISE EXCEPTION 'Permission refusée.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant encaissé doit être supérieur à 0.';
  END IF;

  SELECT id, organization_id, client_id, total_ttc, status
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable.';
  END IF;

  IF v_invoice.status NOT IN ('sent', 'partial') THEN
    RAISE EXCEPTION 'Cette facture ne peut pas recevoir de versement échéancé.';
  END IF;

  SELECT id, invoice_id, organization_id, paid_payment_id
  INTO v_schedule
  FROM public.invoice_payment_schedule
  WHERE id = p_schedule_item_id
    AND invoice_id = p_invoice_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Échéance introuvable.';
  END IF;

  IF v_schedule.paid_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cette échéance est déjà soldée.';
  END IF;

  INSERT INTO public.payments (
    organization_id,
    invoice_id,
    client_id,
    amount,
    payment_date,
    method,
    reference,
    notes,
    created_by
  )
  VALUES (
    v_org_id,
    p_invoice_id,
    v_invoice.client_id,
    ROUND(p_amount, 2),
    COALESCE(p_payment_date, CURRENT_DATE),
    NULLIF(p_method, ''),
    NULLIF(p_reference, ''),
    NULLIF(p_notes, ''),
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.invoice_payment_schedule
  SET paid_payment_id = v_payment_id
  WHERE id = p_schedule_item_id
    AND paid_payment_id IS NULL;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id
    AND organization_id = v_org_id;

  v_status := CASE
    WHEN v_total_paid >= COALESCE(v_invoice.total_ttc, 0) - 0.01 THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE public.invoices
  SET
    total_paid = v_total_paid,
    status = v_status,
    paid_at = CASE WHEN v_status = 'paid' THEN now() ELSE paid_at END
  WHERE id = p_invoice_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'status', v_status,
    'total_paid', v_total_paid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_invoice_schedule_payment(UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated;
