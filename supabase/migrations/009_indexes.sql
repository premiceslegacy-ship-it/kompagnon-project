-- ============================================================
-- 009_indexes.sql
-- Index de performance sur les colonnes fréquemment filtrées
-- ============================================================

-- ----------------------------------------------------------
-- Système (roles, memberships, invitations)
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_roles_org
  ON public.roles(organization_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON public.role_permissions(role_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_perm
  ON public.role_permissions(permission_key);

CREATE INDEX IF NOT EXISTS idx_memberships_org
  ON public.memberships(organization_id);

CREATE INDEX IF NOT EXISTS idx_memberships_user
  ON public.memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_role
  ON public.memberships(role_id);

CREATE INDEX IF NOT EXISTS idx_invitations_token
  ON public.invitations(token);

-- ----------------------------------------------------------
-- Catalogue
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_materials_org
  ON public.materials(organization_id);

CREATE INDEX IF NOT EXISTS idx_labor_rates_org
  ON public.labor_rates(organization_id);

CREATE INDEX IF NOT EXISTS idx_saved_templates_org
  ON public.saved_templates(organization_id);

-- ----------------------------------------------------------
-- Clients
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_org
  ON public.clients(organization_id);

CREATE INDEX IF NOT EXISTS idx_clients_status
  ON public.clients(organization_id, status) WHERE is_archived = false;

-- ----------------------------------------------------------
-- Devis
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_quotes_org
  ON public.quotes(organization_id);

CREATE INDEX IF NOT EXISTS idx_quotes_client
  ON public.quotes(client_id);

CREATE INDEX IF NOT EXISTS idx_quotes_status
  ON public.quotes(organization_id, status) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_quote_sections_quote
  ON public.quote_sections(quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote
  ON public.quote_items(quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_items_section
  ON public.quote_items(section_id);

-- ----------------------------------------------------------
-- Factures
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_org
  ON public.invoices(organization_id);

CREATE INDEX IF NOT EXISTS idx_invoices_client
  ON public.invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices(organization_id, status) WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_invoices_due_date
  ON public.invoices(due_date) WHERE status IN ('sent', 'partial', 'overdue');

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
  ON public.invoice_items(invoice_id);

-- ----------------------------------------------------------
-- Paiements & relances
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_invoice
  ON public.payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_payments_org
  ON public.payments(organization_id);

CREATE INDEX IF NOT EXISTS idx_reminders_org
  ON public.reminders(organization_id);

CREATE INDEX IF NOT EXISTS idx_reminders_invoice
  ON public.reminders(invoice_id);

-- ----------------------------------------------------------
-- Facturation récurrente
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_org
  ON public.recurring_invoices(organization_id);

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_client
  ON public.recurring_invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next
  ON public.recurring_invoices(next_send_date) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_schedules_org
  ON public.invoice_schedules(organization_id);

CREATE INDEX IF NOT EXISTS idx_schedules_recurring
  ON public.invoice_schedules(recurring_invoice_id);

CREATE INDEX IF NOT EXISTS idx_schedules_status
  ON public.invoice_schedules(status) WHERE status = 'pending_confirmation';

-- ----------------------------------------------------------
-- Factures reçues & PA events
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_received_invoices_org
  ON public.received_invoices(organization_id);

CREATE INDEX IF NOT EXISTS idx_received_invoices_siren
  ON public.received_invoices(supplier_siren);

CREATE INDEX IF NOT EXISTS idx_received_invoices_status
  ON public.received_invoices(status);

CREATE INDEX IF NOT EXISTS idx_pa_events_invoice
  ON public.pa_status_events(invoice_id);

CREATE INDEX IF NOT EXISTS idx_pa_events_received
  ON public.pa_status_events(received_invoice_id);

CREATE INDEX IF NOT EXISTS idx_pa_events_org
  ON public.pa_status_events(organization_id);

-- ----------------------------------------------------------
-- Mémoire IA (recherche vectorielle)
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_company_memory_org
  ON public.company_memory(organization_id) WHERE is_active = true;

-- Index IVFFLAT pour la recherche par similarité cosinus (pgvector)
-- Activer uniquement si pgvector est disponible et la table est peuplée
-- CREATE INDEX IF NOT EXISTS idx_company_memory_embedding
--   ON public.company_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ----------------------------------------------------------
-- Logs
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_log_org
  ON public.activity_log(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_org
  ON public.import_jobs(organization_id);
