-- ============================================================
-- 196 — Correctifs de la revue des lots 193-195 (26/10/2026)
-- ------------------------------------------------------------
-- 1. 195 a réécrit enforce_membership_role_change() en omettant le refus
--    d'attribution / de retrait du rôle owner posé par 156 : un détenteur de
--    team.edit_roles pouvait promouvoir un tiers owner ou rétrograder le
--    dirigeant. Garde restaurée.
-- 2. enforce_invoice_lifecycle_permissions() (195) :
--    - la branche « sending/draft » était inversée (`NOT v_server`) : tout
--      membre ayant invoices.edit passait une facture émise en `sending`
--      en écrivant au passage total_paid/paid_at, puis en `sent` : paiement
--      sans invoices.record_payment ;
--    - un BROUILLON sortait du contrôle (RETURN NEW) : passage direct
--      draft -> paid avec total_paid forgé, ou draft -> sent sans
--      invoices.send ;
--    - v_server NULL (aucune claim) faisait sauter silencieusement les gardes
--      (`NOT NULL AND ...` n'est jamais vrai) ;
--    - archiveInvoice (permission invoices.delete) ne pouvait plus passer
--      une facture émise en `cancelled`.
-- 3. quote_items / quote_sections n'étaient pas couverts par l'immutabilité
--    des devis signés : description et lignes d'un devis signé restaient
--    modifiables par n'importe quel membre via PostgREST (seul un changement
--    de total, répercuté sur quotes, était incidemment bloqué).
-- 4. Aucune FK métier ne vérifiait l'organisation de la cible : une facture,
--    un devis, un paiement ou une relance pouvait référencer le client / la
--    facture / le devis d'une autre organisation (les triggers SECURITY
--    DEFINER d'agrégats écrivaient alors chez la victime).
-- 5. generate_invoice_number / generate_quote_number : un simple lecteur
--    consommait des numéros légaux (trous de numérotation) ; garde de
--    permission ajoutée, et `auth.role() <> 'service_role'` NULL laissait
--    passer un appel sans claim.
-- ============================================================

-- ─── 1. Rôle owner : garde restaurée ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_membership_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_is_owner BOOLEAN;
  v_new_is_owner BOOLEAN;
BEGIN
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    RETURN NEW;
  END IF;

  -- service_role : joinViaCode, /invite/accept et Server Actions ont déjà
  -- vérifié leurs permissions côté serveur.
  IF COALESCE(auth.role() = 'service_role', false) THEN
    RETURN NEW;
  END IF;

  IF NOT public.user_has_permission('team.edit_roles') THEN
    RAISE EXCEPTION 'Modification de rôle interdite : permission team.edit_roles requise';
  END IF;

  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Modification de son propre rôle interdite';
  END IF;

  SELECT (slug = 'owner') INTO v_old_is_owner FROM public.roles WHERE id = OLD.role_id;
  SELECT (slug = 'owner') INTO v_new_is_owner FROM public.roles WHERE id = NEW.role_id;
  IF COALESCE(v_old_is_owner, false) OR COALESCE(v_new_is_owner, false) THEN
    RAISE EXCEPTION 'Le rôle owner ne peut pas être attribué ni modifié via cette voie';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_membership_role_change() FROM PUBLIC, anon, authenticated;

-- ─── 2. Transitions de facture ─────────────────────────────────────────────
-- Règles pour un appelant non serveur (service_role : tout passe, les jobs
-- ont leurs propres contrôles) :
--   * brouillon -> envoyée        : invoices.send
--   * -> cancelled                : invoices.delete ou invoices.record_payment
--   * tout autre changement de statut, total_paid, paid_at : record_payment
--   * pa_status / pa_message_id / facturx_xml : einvoicing.configure
CREATE OR REPLACE FUNCTION public.enforce_invoice_lifecycle_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role() = 'service_role', false) THEN
    RETURN NEW;
  END IF;
  -- L'état `sending` est une revendication de job, pas un raccourci de
  -- paiement : aucune identité utilisateur ne peut le réclamer ni le clore.
  IF (NEW.status = 'sending' OR OLD.status = 'sending')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'La transition sending est réservée au serveur';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
      IF NOT public.user_has_permission('invoices.send') THEN
        RAISE EXCEPTION 'invoices.send requis pour émettre une facture';
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      IF NOT (public.user_has_permission('invoices.delete')
              OR public.user_has_permission('invoices.record_payment')) THEN
        RAISE EXCEPTION 'invoices.delete requis pour annuler une facture';
      END IF;
    ELSIF NOT public.user_has_permission('invoices.record_payment') THEN
      RAISE EXCEPTION 'invoices.record_payment requis pour modifier le statut';
    END IF;
  END IF;

  IF (NEW.total_paid IS DISTINCT FROM OLD.total_paid
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at)
     AND NOT public.user_has_permission('invoices.record_payment') THEN
    RAISE EXCEPTION 'invoices.record_payment requis pour modifier un paiement';
  END IF;

  IF (NEW.pa_status IS DISTINCT FROM OLD.pa_status
      OR NEW.pa_message_id IS DISTINCT FROM OLD.pa_message_id
      OR NEW.facturx_xml IS DISTINCT FROM OLD.facturx_xml)
     AND NOT public.user_has_permission('einvoicing.configure') THEN
    RAISE EXCEPTION 'einvoicing.configure requis pour modifier le statut e-facturation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_lifecycle_permissions() FROM PUBLIC, anon, authenticated;

-- ─── 3. Lignes / sections d'un devis signé ou accepté ──────────────────────
-- Un statut accepté/verrouillé ne doit jamais être ramené à un statut
-- déverrouillant les lignes (sent/refused/expired), même par un owner.
CREATE OR REPLACE FUNCTION public.enforce_quote_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'invoice_id', 'converted_at', 'is_archived', 'updated_at',
    'viewed_at', 'pdf_url', 'signature_token', 'signature_token_expires_at',
    'variant_group_id', 'variant_label'
  ];
  v_locked BOOLEAN := OLD.signed_at IS NOT NULL
    OR OLD.status IN ('accepted', 'converted', 'fully_invoiced');
BEGIN
  IF v_locked THEN
    IF (NEW.signature_token IS DISTINCT FROM OLD.signature_token
        OR NEW.signature_token_expires_at IS DISTINCT FROM OLD.signature_token_expires_at)
       AND NOT COALESCE(auth.role() = 'service_role', false) THEN
      RAISE EXCEPTION 'Les jetons de signature sont réservés au serveur après acceptation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT COALESCE(NEW.status IN ('accepted', 'converted', 'fully_invoiced'), false) THEN
      RAISE EXCEPTION 'Devis signé ou accepté : le retour à un statut déverrouillant est interdit';
    END IF;
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
      RAISE EXCEPTION 'Devis signé ou accepté immuable : dupliquer le devis pour corriger';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_quote_immutability() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_quote_children_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT (signed_at IS NOT NULL OR status IN ('accepted', 'converted', 'fully_invoiced'))
      INTO v_locked FROM public.quotes WHERE id = OLD.quote_id;
    IF COALESCE(v_locked, false) THEN
      RAISE EXCEPTION 'Devis signé ou accepté : lignes et sections immuables';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT (signed_at IS NOT NULL OR status IN ('accepted', 'converted', 'fully_invoiced'))
      INTO v_locked FROM public.quotes WHERE id = NEW.quote_id;
    IF COALESCE(v_locked, false) THEN
      RAISE EXCEPTION 'Devis signé ou accepté : lignes et sections immuables';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_quote_children_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_quote_items_immutability ON public.quote_items;
CREATE TRIGGER trg_enforce_quote_items_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_children_immutability();

DROP TRIGGER IF EXISTS trg_enforce_quote_sections_immutability ON public.quote_sections;
CREATE TRIGGER trg_enforce_quote_sections_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_sections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_children_immutability();

-- ─── 4. FK métier : la cible doit appartenir à la même organisation ────────
-- Arguments : paires (colonne, table cible). Évalué à l'INSERT et quand la
-- colonne change ; une cible inexistante est laissée à la contrainte FK.
-- EXECUTE ... INTO ne met pas FOUND à jour ; les lookups dynamiques utilisent
-- donc GET DIAGNOSTICS ROW_COUNT, y compris pour les lignes de document.
CREATE OR REPLACE FUNCTION public.enforce_same_org_refs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  i     INT := 0;
  v_col TEXT;
  v_tbl TEXT;
  v_new UUID;
  v_org UUID;
  v_rows BIGINT;
  v_row JSONB := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id est immuable pour les documents et leurs écritures';
  END IF;

  WHILE i + 1 < TG_NARGS LOOP
    v_col := TG_ARGV[i];
    v_tbl := TG_ARGV[i + 1];
    i := i + 2;

    v_new := NULLIF(v_row ->> v_col, '')::uuid;
    IF v_new IS NULL THEN CONTINUE; END IF;
    IF TG_OP = 'UPDATE'
       AND v_new IS NOT DISTINCT FROM NULLIF(to_jsonb(OLD) ->> v_col, '')::uuid THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', v_tbl)
      INTO v_org USING v_new;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 AND v_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION '% référence un enregistrement d''une autre organisation', v_col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_same_org_refs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_same_org_refs ON public.invoices;
CREATE TRIGGER trg_same_org_refs
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org_refs(
    'client_id', 'clients', 'quote_id', 'quotes', 'chantier_id', 'chantiers');

DROP TRIGGER IF EXISTS trg_same_org_refs ON public.quotes;
CREATE TRIGGER trg_same_org_refs
  BEFORE INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org_refs(
    'client_id', 'clients', 'invoice_id', 'invoices', 'parent_quote_id', 'quotes');

DROP TRIGGER IF EXISTS trg_same_org_refs ON public.payments;
CREATE TRIGGER trg_same_org_refs
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org_refs(
    'invoice_id', 'invoices', 'client_id', 'clients');

DROP TRIGGER IF EXISTS trg_same_org_refs ON public.reminders;
CREATE TRIGGER trg_same_org_refs
  BEFORE INSERT OR UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org_refs(
    'invoice_id', 'invoices', 'quote_id', 'quotes', 'client_id', 'clients');

-- quote_items / invoice_items n'ont pas de colonne organization_id : leur
-- propriétaire est celui du document parent, à partir duquel les références
-- vers le catalogue doivent être validées.
CREATE OR REPLACE FUNCTION public.enforce_document_item_same_org_refs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  i             INT := 2;
  v_parent_id   UUID;
  v_parent_org  UUID;
  v_ref         UUID;
  v_ref_org     UUID;
  v_rows BIGINT;
  v_col         TEXT;
  v_tbl         TEXT;
  v_row         JSONB := to_jsonb(NEW);
  v_section_quote UUID;
BEGIN
  v_parent_id := NULLIF(v_row ->> TG_ARGV[1], '')::uuid;
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO v_parent_org USING v_parent_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'quote_items' THEN
    IF NEW.section_id IS NOT NULL THEN
      SELECT quote_id INTO v_section_quote FROM public.quote_sections WHERE id = NEW.section_id;
      IF FOUND AND v_section_quote IS DISTINCT FROM NEW.quote_id THEN
        RAISE EXCEPTION 'section_id référence une section d''un autre devis';
      END IF;
    END IF;
  END IF;

  WHILE i + 1 < TG_NARGS LOOP
    v_col := TG_ARGV[i];
    v_tbl := TG_ARGV[i + 1];
    i := i + 2;
    v_ref := NULLIF(v_row ->> v_col, '')::uuid;
    IF v_ref IS NULL THEN CONTINUE; END IF;

    EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', v_tbl)
      INTO v_ref_org USING v_ref;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 AND v_ref_org IS DISTINCT FROM v_parent_org THEN
      RAISE EXCEPTION '% référence un enregistrement d''une autre organisation', v_col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_document_item_same_org_refs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_items_same_org_refs ON public.quote_items;
CREATE TRIGGER trg_quote_items_same_org_refs
  BEFORE INSERT OR UPDATE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_item_same_org_refs(
    'quotes', 'quote_id',
    'material_id', 'materials',
    'labor_rate_id', 'labor_rates',
    'metal_grid_id', 'metal_price_grids',
    'catalog_variant_id', 'material_price_variants');

DROP TRIGGER IF EXISTS trg_invoice_items_same_org_refs ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_same_org_refs
  BEFORE INSERT OR UPDATE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_item_same_org_refs(
    'invoices', 'invoice_id',
    'material_id', 'materials',
    'catalog_variant_id', 'material_price_variants');

-- ─── 5. Numérotation légale : permission + garde sans claim ────────────────
CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    IF org_id IS DISTINCT FROM public.get_user_org_id() THEN
      RAISE EXCEPTION 'Organisation non autorisée';
    END IF;
    IF NOT public.user_has_permission('invoices.create') THEN
      RAISE EXCEPTION 'invoices.create requis';
    END IF;
  END IF;

  PERFORM set_config('app.org_numbering', 'on', true);
  UPDATE public.organizations
  SET last_invoice_number = last_invoice_number + 1
  WHERE id = org_id
  RETURNING last_invoice_number, invoice_prefix INTO next_num, org_prefix;

  PERFORM set_config('app.org_numbering', 'off', true);
  RETURN COALESCE(org_prefix, 'FAC') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_quote_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    IF org_id IS DISTINCT FROM public.get_user_org_id() THEN
      RAISE EXCEPTION 'Organisation non autorisée';
    END IF;
    IF NOT public.user_has_permission('quotes.create') THEN
      RAISE EXCEPTION 'quotes.create requis';
    END IF;
  END IF;

  PERFORM set_config('app.org_numbering', 'on', true);
  UPDATE public.organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;

  PERFORM set_config('app.org_numbering', 'off', true);
  RETURN COALESCE(org_prefix, 'DEV') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;
-- Les numéros sont appelables depuis les Server Actions authentifiées, mais
-- jamais par anon/PUBLIC ; les tâches serveur gardent leur accès explicite.
REVOKE ALL ON FUNCTION public.generate_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_quote_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_quote_number(uuid) TO authenticated, service_role;
