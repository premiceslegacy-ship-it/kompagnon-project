-- 217 : rattrape l'écart entre la base de production partagée et l'historique des migrations.
--
-- Constat (recette Weber, 9 novembre 2026) : sur `atelier-app`, les migrations 018, 078, 009 et 177
-- sont enregistrées comme appliquées, mais une partie de leurs objets n'existe pas. Le déclencheur
-- `protect_org_server_columns` (193/198) lit `organizations.facturx_enabled`, absente : toute mise à jour
-- de `organizations` échouait, dont la numérotation des devis et des factures
-- (« Erreur lors de la création du devis »).
--
-- Tout est idempotent (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS) : sans effet sur une
-- base déjà à jour.

-- ── 018 : colonnes Factur-X ────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS facturx_enabled    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS facturx_profile    TEXT    DEFAULT 'EN_16931',
  ADD COLUMN IF NOT EXISTS bank_iban          TEXT,
  ADD COLUMN IF NOT EXISTS bank_bic           TEXT,
  ADD COLUMN IF NOT EXISTS payment_means_code TEXT    DEFAULT '30';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS buyer_reference        TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_ref     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_date          DATE,
  ADD COLUMN IF NOT EXISTS period_start           DATE,
  ADD COLUMN IF NOT EXISTS period_end             DATE,
  ADD COLUMN IF NOT EXISTS payment_means_code     TEXT,
  ADD COLUMN IF NOT EXISTS preceding_invoice_ref  TEXT,
  ADD COLUMN IF NOT EXISTS preceding_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS invoice_type_code      TEXT DEFAULT '380';

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS product_code TEXT,
  ADD COLUMN IF NOT EXISTS unspsc_code  TEXT;

-- ── 177 : autonomie de Sarah ───────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sarah_auto_low_risk BOOLEAN NOT NULL DEFAULT false;

-- ── 009 et 018 : index ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_quote_items_section
  ON public.quote_items(section_id);

CREATE INDEX IF NOT EXISTS idx_invoices_due_date
  ON public.invoices(due_date) WHERE status IN ('sent', 'partial', 'overdue');

CREATE INDEX IF NOT EXISTS idx_invoices_facturx
  ON public.invoices(organization_id)
  WHERE facturx_xml IS NOT NULL;

-- ── 078 : échéancier de paiement (index, politiques, contrôles, encaissement) ─
-- Rejoué tel quel depuis 078 ; les politiques sont recréées proprement.

-- Index pour les lookups courants
CREATE INDEX IF NOT EXISTS idx_invoice_payment_schedule_invoice_id
  ON public.invoice_payment_schedule(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_schedule_due_date
  ON public.invoice_payment_schedule(due_date)
  WHERE paid_payment_id IS NULL; -- échéances non soldées

-- RLS
ALTER TABLE public.invoice_payment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation_invoice_payment_schedule" ON public.invoice_payment_schedule;

DROP POLICY IF EXISTS "invoice_payment_schedule_select" ON public.invoice_payment_schedule;
CREATE POLICY "invoice_payment_schedule_select"
  ON public.invoice_payment_schedule
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.view')
  );

DROP POLICY IF EXISTS "invoice_payment_schedule_insert" ON public.invoice_payment_schedule;
CREATE POLICY "invoice_payment_schedule_insert"
  ON public.invoice_payment_schedule
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.edit')
  );

DROP POLICY IF EXISTS "invoice_payment_schedule_update" ON public.invoice_payment_schedule;
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

DROP POLICY IF EXISTS "invoice_payment_schedule_delete" ON public.invoice_payment_schedule;
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
