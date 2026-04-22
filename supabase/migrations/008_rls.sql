-- ============================================================
-- 008_rls.sql
-- Row Level Security : activation + politiques par table
-- Dépend de : 006_functions.sql (get_user_org_id, user_has_permission)
-- ============================================================

-- ----------------------------------------------------------
-- Activation RLS sur toutes les tables publiques
-- ----------------------------------------------------------
ALTER TABLE public.organizations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_invoice_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_schedules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.received_invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pa_status_events         ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- profiles
-- Lecture : profil propre OU membre de la même org (pour l'onglet équipe)
-- Écriture : profil propre uniquement
-- ----------------------------------------------------------
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2
        ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid()
        AND m1.is_active = true
        AND m2.user_id = id
        AND m2.is_active = true
    )
  );

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ----------------------------------------------------------
-- organizations
-- Membres de l'org peuvent lire + owner/admin peuvent modifier
-- ----------------------------------------------------------
CREATE POLICY "organizations_select"
  ON public.organizations FOR SELECT TO authenticated
  USING (id = public.get_user_org_id());

CREATE POLICY "organizations_update"
  ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.get_user_org_id())
  WITH CHECK (
    id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_org')
  );

-- ----------------------------------------------------------
-- permissions
-- Table de référence — lecture libre pour tous les membres
-- Pas d'écriture applicative (peuplée uniquement via migration)
-- ----------------------------------------------------------
CREATE POLICY "permissions_select"
  ON public.permissions FOR SELECT TO authenticated
  USING (true);

-- ----------------------------------------------------------
-- roles
-- Lecture : tous les membres de l'org
-- Écriture : settings.edit_roles requis
-- ----------------------------------------------------------
CREATE POLICY "roles_select"
  ON public.roles FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "roles_insert"
  ON public.roles FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_roles')
  );

CREATE POLICY "roles_update"
  ON public.roles FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_roles')
  );

CREATE POLICY "roles_delete"
  ON public.roles FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_roles')
    AND is_system = false
  );

-- ----------------------------------------------------------
-- role_permissions
-- Lecture : tous les membres
-- Écriture : settings.edit_roles requis
-- ----------------------------------------------------------
CREATE POLICY "role_permissions_select"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (
    role_id IN (
      SELECT id FROM public.roles WHERE organization_id = public.get_user_org_id()
    )
  );

CREATE POLICY "role_permissions_all"
  ON public.role_permissions FOR ALL TO authenticated
  USING (
    public.user_has_permission('settings.edit_roles')
    AND role_id IN (
      SELECT id FROM public.roles WHERE organization_id = public.get_user_org_id()
    )
  );

-- ----------------------------------------------------------
-- memberships
-- Lecture : tous les membres de l'org
-- Modification : admin avec team.edit_roles / team.remove_members
-- ----------------------------------------------------------
CREATE POLICY "memberships_select"
  ON public.memberships FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "memberships_update"
  ON public.memberships FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

-- ----------------------------------------------------------
-- invitations
-- Lecture : membres avec team.invite
-- Insertion : membres avec team.invite
-- ----------------------------------------------------------
CREATE POLICY "invitations_select"
  ON public.invitations FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "invitations_insert"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('team.invite')
  );

-- ----------------------------------------------------------
-- clients
-- ----------------------------------------------------------
CREATE POLICY "clients_select"
  ON public.clients FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('clients.view')
  );

CREATE POLICY "clients_insert"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('clients.create')
  );

CREATE POLICY "clients_update"
  ON public.clients FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('clients.edit')
  );

CREATE POLICY "clients_delete"
  ON public.clients FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('clients.delete')
  );

-- ----------------------------------------------------------
-- materials + labor_rates
-- ----------------------------------------------------------
CREATE POLICY "materials_org_member"
  ON public.materials FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "labor_rates_org_member"
  ON public.labor_rates FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "saved_templates_org_member"
  ON public.saved_templates FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

-- ----------------------------------------------------------
-- quotes
-- ----------------------------------------------------------
CREATE POLICY "quotes_select"
  ON public.quotes FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.view')
  );

CREATE POLICY "quotes_insert"
  ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.create')
  );

CREATE POLICY "quotes_update"
  ON public.quotes FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.edit')
  );

CREATE POLICY "quotes_delete"
  ON public.quotes FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.delete')
  );

-- quote_sections et quote_items : accès via quote
CREATE POLICY "quote_sections_org_member"
  ON public.quote_sections FOR ALL TO authenticated
  USING (
    quote_id IN (
      SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    quote_id IN (
      SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()
    )
  );

CREATE POLICY "quote_items_org_member"
  ON public.quote_items FOR ALL TO authenticated
  USING (
    quote_id IN (
      SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    quote_id IN (
      SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()
    )
  );

-- ----------------------------------------------------------
-- invoices
-- ----------------------------------------------------------
CREATE POLICY "invoices_select"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.view')
  );

CREATE POLICY "invoices_insert"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.create')
  );

CREATE POLICY "invoices_update"
  ON public.invoices FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "invoices_delete"
  ON public.invoices FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.delete')
  );

-- invoice_items : accès via invoice
CREATE POLICY "invoice_items_org_member"
  ON public.invoice_items FOR ALL TO authenticated
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    invoice_id IN (
      SELECT id FROM public.invoices WHERE organization_id = public.get_user_org_id()
    )
  );

-- ----------------------------------------------------------
-- payments
-- ----------------------------------------------------------
CREATE POLICY "payments_org_member"
  ON public.payments FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.record_payment')
  );

-- ----------------------------------------------------------
-- reminders
-- ----------------------------------------------------------
CREATE POLICY "reminders_org_member"
  ON public.reminders FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

-- ----------------------------------------------------------
-- Tables avancées — pattern simplifié : org_member
-- ----------------------------------------------------------
CREATE POLICY "company_memory_org_member"
  ON public.company_memory FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "goals_org_member"
  ON public.goals FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "email_templates_org_member"
  ON public.email_templates FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "import_jobs_org_member"
  ON public.import_jobs FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "activity_log_org_member"
  ON public.activity_log FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

-- activity_log : écriture uniquement via service_role (server actions)

-- ----------------------------------------------------------
-- Facturation récurrente
-- ----------------------------------------------------------
CREATE POLICY "recurring_invoices_org_member"
  ON public.recurring_invoices FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "recurring_invoice_items_org_member"
  ON public.recurring_invoice_items FOR ALL TO authenticated
  USING (
    recurring_invoice_id IN (
      SELECT id FROM public.recurring_invoices
      WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    recurring_invoice_id IN (
      SELECT id FROM public.recurring_invoices
      WHERE organization_id = public.get_user_org_id()
    )
  );

CREATE POLICY "invoice_schedules_org_member"
  ON public.invoice_schedules FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

-- ----------------------------------------------------------
-- Factures reçues (B2Brouter webhook)
-- Lecture : membres avec received_invoices.view
-- Insertion : uniquement service_role (webhook)
-- ----------------------------------------------------------
CREATE POLICY "received_invoices_select"
  ON public.received_invoices FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('received_invoices.view')
  );

CREATE POLICY "received_invoices_update"
  ON public.received_invoices FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('received_invoices.process')
  );

-- pa_status_events : lecture seule pour les membres, écriture via service_role
CREATE POLICY "pa_events_read_org"
  ON public.pa_status_events FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());
