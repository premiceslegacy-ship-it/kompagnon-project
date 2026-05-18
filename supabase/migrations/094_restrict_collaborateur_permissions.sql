-- Migration 094 : Retirer chantiers.edit et invoices.create des rôles collaborateur/employee
-- Raison : ces rôles ne doivent pas pouvoir modifier librement les chantiers ni créer des factures

-- 1. Retirer ces permissions des rôles collaborateur et employee existants
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.slug IN ('collaborateur', 'employee')
  AND rp.permission_key IN ('chantiers.edit', 'invoices.create');

-- 2. Mettre à jour initialize_organization_for_user pour les nouvelles orgs
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
  -- Créer l'organisation
  INSERT INTO public.organizations (name, owner_id)
  VALUES ('Mon Atelier', p_user_id)
  RETURNING id INTO v_org_id;

  -- Créer les rôles par défaut
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

  -- Commercial
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

  -- Technicien (employee) : pas chantiers.edit ni invoices.create
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

  -- Collaborateur : pas chantiers.edit ni invoices.create
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

  -- Membership owner
  INSERT INTO public.memberships (organization_id, user_id, role_id, status)
  VALUES (v_org_id, p_user_id, v_owner_role_id, 'active');

  -- Profile (upsert)
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (p_user_id, p_full_name, p_email)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

END;
$$;
