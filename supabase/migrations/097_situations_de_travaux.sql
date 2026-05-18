-- ============================================================
-- 097_situations_de_travaux.sql
-- Module situations de travaux (facturation à l'avancement)
-- ============================================================

-- ── 1. Colonnes sur invoices ──────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS situation_number  integer,
  ADD COLUMN IF NOT EXISTS cumulative_pct    numeric(5,2),
  ADD COLUMN IF NOT EXISTS period_from       date,
  ADD COLUMN IF NOT EXISTS period_to         date,
  ADD COLUMN IF NOT EXISTS retention_pct     numeric(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_amount  numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS market_reference  text;

COMMENT ON COLUMN public.invoices.situation_number IS
  'Numéro d''ordre de la situation sur ce devis (1, 2, 3…)';
COMMENT ON COLUMN public.invoices.cumulative_pct IS
  'Pourcentage cumulé facturé jusqu''à cette situation incluse (stocké à la création)';
COMMENT ON COLUMN public.invoices.period_from IS
  'Début de la période d''exécution couverte par la situation';
COMMENT ON COLUMN public.invoices.period_to IS
  'Fin de la période d''exécution couverte par la situation';
COMMENT ON COLUMN public.invoices.retention_pct IS
  'Taux de retenue de garantie appliqué (souvent 5%)';
COMMENT ON COLUMN public.invoices.retention_amount IS
  'Montant retenu (HT × retention_pct / 100) — déduit du net à payer';
COMMENT ON COLUMN public.invoices.market_reference IS
  'Référence marché / N° d''affaire (demandé par certains MOA)';

-- Index pour récupérer toutes les situations d'un devis, triées
CREATE INDEX IF NOT EXISTS idx_invoices_quote_situation
  ON public.invoices (quote_id, situation_number)
  WHERE invoice_type IN ('situation', 'solde') AND quote_id IS NOT NULL;

-- ── 2. Contrainte CHECK sur invoice_type ─────────────────────────────────────

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('standard', 'acompte', 'situation', 'solde'));

-- ── 3. Statut fully_invoiced sur quotes ──────────────────────────────────────

-- Le statut quotes.status est un TEXT — on documente la valeur attendue
COMMENT ON COLUMN public.quotes.status IS
  'draft | sent | viewed | accepted | refused | expired | converted | fully_invoiced';

-- ── 4. Champ parent_quote_id sur quotes (avenants) ───────────────────────────

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS parent_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quotes.parent_quote_id IS
  'Référence au devis initial si ce devis est un avenant/modificatif';

-- ── 5. Permissions situations de travaux ─────────────────────────────────────

INSERT INTO public.permissions (key, label, category, position) VALUES
  ('invoices.create_situation', 'Créer une situation de travaux', 'invoices', 12),
  ('invoices.create_solde',     'Émettre le solde de chantier',   'invoices', 13)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- Attribution aux rôles existants (Owner : bypass *, Admin et Manager : oui, autres : non)
-- On cible les orgs existantes en insérant dans role_permissions pour les rôles admin/manager
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, p.key, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('owner', 'admin', 'manager')
  AND p.key IN ('invoices.create_situation', 'invoices.create_solde')
ON CONFLICT (role_id, permission_key) DO UPDATE SET is_allowed = true;

-- Mettre à jour initialize_organization_for_user pour les nouvelles orgs
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
  v_collab_role_id      UUID;
  v_viewer_role_id      UUID;
BEGIN
  INSERT INTO public.organizations (name, owner_id)
  VALUES ('Mon Atelier', p_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Propriétaire', 'owner', 'Accès total', 1, '#7c3aed')
  RETURNING id INTO v_owner_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Administrateur', 'admin', 'Gestion complète sauf suppression org', 2, '#2563eb')
  RETURNING id INTO v_admin_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Manager', 'manager', 'Gestion opérationnelle', 3, '#0891b2')
  RETURNING id INTO v_manager_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Commercial', 'commercial', 'Devis, factures, clients', 4, '#059669')
  RETURNING id INTO v_commercial_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Technicien', 'employee', 'Accès terrain', 5, '#d97706')
  RETURNING id INTO v_employee_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Collaborateur', 'collaborateur', 'Accès collaborateur (rejoint via code)', 6, '#64748b')
  RETURNING id INTO v_collab_role_id;

  INSERT INTO public.roles (organization_id, name, slug, description, position, color)
  VALUES (v_org_id, 'Lecteur', 'viewer', 'Lecture seule', 7, '#94a3b8')
  RETURNING id INTO v_viewer_role_id;

  -- Owner : tout
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_owner_role_id, key, true FROM public.permissions;

  -- Admin
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_admin_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca','dashboard.view_goals','dashboard.set_goals',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.delete','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.delete',
    'invoices.record_payment','invoices.create_credit',
    'invoices.create_situation','invoices.create_solde',
    'received_invoices.view','received_invoices.process','received_invoices.reject',
    'einvoicing.view_status','einvoicing.configure',
    'clients.view','clients.create','clients.edit','clients.delete','clients.export',
    'catalog.view','catalog.edit','catalog.delete',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.delete',
    'chantiers.pointage','chantiers.manage_team','chantiers.view_tasks','chantiers.manage_tasks',
    'leads.view','leads.manage',
    'team.view','team.invite','team.manage','team.edit_roles','team.remove_members',
    'reminders.view','reminders.send_manual','reminders.configure_auto',
    'settings.view','settings.edit','settings.edit_org','settings.edit_branding',
    'settings.edit_emails','settings.edit_goals','settings.edit_roles',
    'import.clients','import.history','reports.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Manager
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_manager_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca','dashboard.view_goals','dashboard.set_goals',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.delete','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.delete',
    'invoices.record_payment','invoices.create_credit',
    'invoices.create_situation','invoices.create_solde',
    'received_invoices.view','received_invoices.process',
    'clients.view','clients.create','clients.edit','clients.delete','clients.export',
    'catalog.view','catalog.edit','catalog.delete',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.delete',
    'chantiers.pointage','chantiers.manage_team','chantiers.view_tasks','chantiers.manage_tasks',
    'leads.view','leads.manage',
    'team.view','team.invite','team.manage',
    'reminders.view','reminders.send_manual','reminders.configure_auto',
    'settings.view','settings.edit','settings.edit_org','settings.edit_branding',
    'settings.edit_emails','settings.edit_goals',
    'import.clients','import.history','reports.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Commercial : pas de situation ni solde
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_commercial_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send',
    'clients.view','clients.create','clients.edit',
    'catalog.view','catalog.edit',
    'chantiers.view','chantiers.pointage','chantiers.view_tasks',
    'leads.view','leads.manage',
    'team.view',
    'reminders.view','reminders.send_manual',
    'settings.view','reports.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Technicien
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_employee_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view','catalog.edit',
    'chantiers.view','chantiers.create','chantiers.pointage',
    'chantiers.view_tasks','chantiers.manage_tasks',
    'chantiers.expenses.create',
    'leads.view',
    'team.view','reminders.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Collaborateur
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_collab_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view',
    'chantiers.view','chantiers.pointage',
    'chantiers.view_tasks',
    'chantiers.expenses.create',
    'team.view','reminders.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Lecteur
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_viewer_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view',
    'chantiers.view','chantiers.view_tasks',
    'team.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  INSERT INTO public.memberships (organization_id, user_id, role_id, status)
  VALUES (v_org_id, p_user_id, v_owner_role_id, 'active');

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (p_user_id, p_full_name, p_email)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

END;
$$;
