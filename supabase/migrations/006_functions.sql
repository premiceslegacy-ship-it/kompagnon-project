-- ============================================================
-- 006_functions.sql
-- Fonctions PostgreSQL : helpers RLS, numérotation, triggers, init org
-- Dépend de : 002_core_tables.sql (tables en place)
-- ============================================================

-- ----------------------------------------------------------
-- set_updated_at
-- Met à jour automatiquement la colonne updated_at
-- Appelée par les triggers "before update" sur chaque table
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- create_updated_at_trigger
-- Helper : crée le trigger set_updated_at sur n'importe quelle table
-- Usage : SELECT create_updated_at_trigger('my_table');
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_updated_at_trigger(tbl_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER set_updated_at
     BEFORE UPDATE ON public.%I
     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
    tbl_name
  );
END;
$$;

-- ----------------------------------------------------------
-- rls_auto_enable
-- Active RLS sur toutes les tables publiques (appelable manuellement)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- ----------------------------------------------------------
-- get_user_org_id
-- Renvoie l'organization_id de l'utilisateur connecté
-- Utilisée dans les politiques RLS
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM public.memberships
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- ----------------------------------------------------------
-- user_has_permission
-- Vérifie qu'un utilisateur possède une permission donnée
-- Utilisée dans les politiques RLS et le code applicatif
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.role_permissions rp ON rp.role_id = m.role_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND rp.permission_key = perm_key
      AND rp.is_allowed = true
  );
$$;

-- ----------------------------------------------------------
-- generate_join_code
-- Génère un code entreprise lisible : XXX-XXXX
-- Caractères : A-Z (sans I, O) + 2-9 (sans 0, 1) = 32 chars
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INT;
BEGIN
  -- 3 caractères
  FOR i IN 1..3 LOOP
    code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  code := code || '-';
  -- 4 caractères
  FOR i IN 1..4 LOOP
    code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN code;
END;
$$;

-- ----------------------------------------------------------
-- generate_quote_number
-- Génère le prochain numéro de devis séquentiel pour une org
-- Format : {prefix}-{YYYY}-{NNNN} ex: DEV-2024-0042
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_quote_number(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  UPDATE public.organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;

  RETURN org_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 4, '0');
END;
$$;

-- ----------------------------------------------------------
-- generate_invoice_number
-- Génère le prochain numéro de facture séquentiel pour une org
-- Format : {prefix}-{YYYY}-{NNNN} ex: FAC-2024-0042
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  UPDATE public.organizations
  SET last_invoice_number = last_invoice_number + 1
  WHERE id = org_id
  RETURNING last_invoice_number, invoice_prefix INTO next_num, org_prefix;

  RETURN org_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 4, '0');
END;
$$;

-- ----------------------------------------------------------
-- compute_vat_amount
-- Calcule automatiquement vat_amount sur invoice_items
-- Déclenché par trigger BEFORE INSERT OR UPDATE sur invoice_items
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_vat_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.vat_amount := ROUND(
    (NEW.unit_price * NEW.quantity * NEW.vat_rate / 100)::NUMERIC,
    2
  );
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- update_client_totals
-- Met à jour total_revenue et total_paid du client après chaque paiement
-- Déclenché par trigger AFTER INSERT OR UPDATE sur payments
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_client_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.clients SET
    total_revenue = (
      SELECT COALESCE(SUM(total_ttc), 0)
      FROM public.invoices
      WHERE client_id = NEW.client_id
        AND status NOT IN ('cancelled', 'refunded')
        AND is_archived = false
    ),
    total_paid = (
      SELECT COALESCE(SUM(p.amount), 0)
      FROM public.payments p
      JOIN public.invoices i ON p.invoice_id = i.id
      WHERE i.client_id = NEW.client_id
    )
  WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- handle_new_user
-- Crée automatiquement le profil à l'inscription (auth.users → profiles)
-- Déclenché par trigger on_auth_user_created sur auth.users
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- initialize_organization_for_user
-- Crée l'organisation, les rôles par défaut et le membership de l'owner
-- Appelée par handle_new_user_init (trigger on_auth_user_created_init_org)
-- Les permissions seront associées APRÈS l'insertion dans permissions (010_seed_permissions.sql)
-- ⚠️  IMPORTANT : dépend de la table permissions étant peuplée au moment de l'appel
--                 (010_seed_permissions.sql doit être exécuté avant le 1er signup)
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_organization_for_user(
  p_user_id   UUID,
  p_full_name TEXT,
  p_email     TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id              UUID;
  v_owner_role_id       UUID;
  v_admin_role_id       UUID;
  v_manager_role_id     UUID;
  v_commercial_role_id  UUID;
  v_employee_role_id    UUID;
  v_viewer_role_id      UUID;
  v_collab_role_id      UUID;
  v_slug                TEXT;
  v_org_name            TEXT;
BEGIN
  -- Nom et slug temporaires (l'owner les mettra à jour dans l'onboarding)
  v_org_name := COALESCE(p_full_name, 'Mon Entreprise');
  -- Slug temporaire : l'owner le remplace via completeOnboarding()
  v_slug := lower(
    regexp_replace(COALESCE(p_full_name, 'entreprise'), '[^a-zA-Z0-9]+', '-', 'g')
  ) || '-' || substr(gen_random_uuid()::text, 1, 8);

  -- Créer l'organisation
  INSERT INTO public.organizations (name, slug, email, sector, join_code)
  VALUES (
    v_org_name,
    v_slug,
    COALESCE(p_email, ''),
    'other',
    public.generate_join_code()
  )
  RETURNING id INTO v_org_id;

  -- ── Rôles par défaut ────────────────────────────────────────────────────────
  INSERT INTO public.roles (organization_id, name, slug, description, position, is_system, color)
  VALUES (v_org_id, 'Dirigeant', 'owner', 'Accès total — ne peut pas être retiré', 0, true, '#f59e0b')
  RETURNING id INTO v_owner_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Administrateur', 'admin', 'Tous les droits sauf les réglages système', 1, '#6366f1')
  RETURNING id INTO v_admin_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Manager', 'manager', 'Gestion complète sauf administration', 2, '#8b5cf6')
  RETURNING id INTO v_manager_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Commercial', 'commercial', 'Devis, clients, relances', 3, '#10b981')
  RETURNING id INTO v_commercial_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Technicien', 'employee', 'Consultation et brouillons', 4, '#3b82f6')
  RETURNING id INTO v_employee_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Lecteur', 'viewer', 'Consultation uniquement', 5, '#9494a8')
  RETURNING id INTO v_viewer_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Collaborateur', 'collaborateur', 'Accès collaborateur (rejoint via code)', 6, '#64748b')
  RETURNING id INTO v_collab_role_id;

  -- ── Permissions : Owner — tout est autorisé ─────────────────────────────────
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_owner_role_id, key, true FROM public.permissions;

  -- ── Permissions : Admin — tout sauf settings.edit_roles + team.remove_members
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_admin_role_id, key,
    CASE WHEN key IN ('settings.edit_roles', 'team.remove_members') THEN false ELSE true END
  FROM public.permissions;

  -- ── Permissions : Manager
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_manager_role_id, key, CASE
    WHEN key IN (
      'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.convert_invoice',
      'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.record_payment',
      'clients.view','clients.create','clients.edit','clients.export',
      'reminders.view','reminders.send_manual','reminders.configure_auto',
      'catalog.view','catalog.edit',
      'dashboard.view_ca','dashboard.view_goals',
      'settings.view','settings.edit_emails'
    ) THEN true ELSE false END
  FROM public.permissions;

  -- ── Permissions : Commercial
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_commercial_role_id, key, CASE
    WHEN key IN (
      'quotes.view','quotes.create','quotes.edit','quotes.send',
      'clients.view','clients.create','clients.edit',
      'reminders.view','reminders.send_manual',
      'catalog.view',
      'dashboard.view_ca'
    ) THEN true ELSE false END
  FROM public.permissions;

  -- ── Permissions : Technicien (employee)
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_employee_role_id, key, CASE
    WHEN key IN (
      'quotes.view','quotes.create',
      'clients.view',
      'catalog.view',
      'dashboard.view_ca'
    ) THEN true ELSE false END
  FROM public.permissions;

  -- ── Permissions : Lecteur (viewer)
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_viewer_role_id, key, CASE
    WHEN key IN ('quotes.view','invoices.view','clients.view','catalog.view')
    THEN true ELSE false END
  FROM public.permissions;

  -- ── Permissions : Collaborateur (même que Technicien)
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_collab_role_id, key, CASE
    WHEN key IN (
      'quotes.view','quotes.create',
      'clients.view',
      'catalog.view',
      'dashboard.view_ca'
    ) THEN true ELSE false END
  FROM public.permissions;

  -- ── Membership owner ────────────────────────────────────────────────────────
  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES (v_org_id, p_user_id, v_owner_role_id, now(), true);

END;
$$;

-- ----------------------------------------------------------
-- handle_new_user_init
-- Trigger function : lance initialize_organization_for_user à l'inscription
-- Déclenché par on_auth_user_created_init_org sur auth.users
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.initialize_organization_for_user(
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  RETURN NEW;
END;
$$;
