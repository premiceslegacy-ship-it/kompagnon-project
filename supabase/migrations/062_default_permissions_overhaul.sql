-- ============================================================
-- 062_default_permissions_overhaul.sql
-- Inclut aussi : fix get_user_org_id ORDER BY accepted_at DESC NULLS LAST
-- Refonte des permissions par défaut :
--   1. Ajouter team.view comme permission séparée (déjà dans 010 mais pas attribuée)
--   2. Redéfinir les permissions de tous les rôles non-owner dans toutes les orgs
--   3. Mettre à jour initialize_organization_for_user pour les nouvelles orgs
-- ============================================================

-- ----------------------------------------------------------
-- 0. Fix get_user_org_id : ORDER BY accepted_at DESC NULLS LAST
--    pour toujours retourner le membership le plus récent (évite l'org orpheline)
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
  ORDER BY accepted_at DESC NULLS LAST
  LIMIT 1;
$$;

-- ----------------------------------------------------------
-- 1. Nouvelles permissions à ajouter si manquantes
-- ----------------------------------------------------------
INSERT INTO public.permissions (key, label, category, position) VALUES
  ('chantiers.view',        'Voir les chantiers',        'chantiers', 1),
  ('chantiers.create',      'Créer des chantiers',       'chantiers', 2),
  ('chantiers.edit',        'Modifier des chantiers',    'chantiers', 3),
  ('chantiers.delete',      'Supprimer des chantiers',   'chantiers', 4),
  ('chantiers.pointage',    'Pointer ses heures',        'chantiers', 5),
  ('chantiers.manage_team', 'Gérer l''équipe chantier',  'chantiers', 6),
  ('chantiers.view_tasks',  'Voir les tâches',           'chantiers', 7),
  ('chantiers.manage_tasks','Gérer les tâches',          'chantiers', 8),
  ('leads.view',   'Voir les demandes (leads)',     'leads', 1),
  ('leads.manage', 'Traiter et gérer les demandes', 'leads', 2)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- ----------------------------------------------------------
-- 2. Redéfinir les permissions de tous les rôles existants
--    (hors owner — il garde tout)
-- ----------------------------------------------------------

-- Collaborateur & Technicien : accès large, pas d'admin
-- Même traitement peu importe la façon dont ils ont rejoint
DO $$
DECLARE
  r RECORD;
  -- Permissions accordées par défaut à tout membre
  collab_perms TEXT[] := ARRAY[
    -- Dashboard
    'dashboard.view', 'dashboard.view_ca',
    -- Devis
    'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.send',
    -- Factures
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.send',
    -- Clients
    'clients.view', 'clients.create', 'clients.edit',
    -- Catalogue
    'catalog.view', 'catalog.edit',
    -- Chantiers
    'chantiers.view', 'chantiers.create', 'chantiers.edit', 'chantiers.pointage',
    'chantiers.view_tasks', 'chantiers.manage_tasks',
    -- Leads
    'leads.view', 'leads.manage',
    -- Équipe (voir uniquement)
    'team.view',
    -- Paramètres (voir uniquement)
    'settings.view',
    -- Relances
    'reminders.view'
  ];
  -- Permissions supplémentaires pour Manager
  manager_perms TEXT[] := ARRAY[
    'dashboard.view', 'dashboard.view_ca', 'dashboard.view_goals', 'dashboard.set_goals',
    'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.send', 'quotes.delete', 'quotes.convert_invoice',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.send', 'invoices.delete',
    'invoices.record_payment', 'invoices.create_credit',
    'received_invoices.view', 'received_invoices.process',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'clients.export',
    'catalog.view', 'catalog.edit', 'catalog.delete',
    'chantiers.view', 'chantiers.create', 'chantiers.edit', 'chantiers.delete',
    'chantiers.pointage', 'chantiers.manage_team',
    'chantiers.view_tasks', 'chantiers.manage_tasks',
    'leads.view', 'leads.manage',
    'team.view', 'team.invite', 'team.manage',
    'reminders.view', 'reminders.send_manual', 'reminders.configure_auto',
    'settings.view', 'settings.edit', 'settings.edit_org', 'settings.edit_branding',
    'settings.edit_emails', 'settings.edit_goals',
    'import.clients', 'import.history',
    'reports.view'
  ];
  -- Permissions pour Admin (tout sauf edit_roles et suppression compte)
  admin_perms TEXT[] := ARRAY[
    'dashboard.view', 'dashboard.view_ca', 'dashboard.view_goals', 'dashboard.set_goals',
    'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.send', 'quotes.delete', 'quotes.convert_invoice',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.send', 'invoices.delete',
    'invoices.record_payment', 'invoices.create_credit',
    'received_invoices.view', 'received_invoices.process', 'received_invoices.reject',
    'einvoicing.view_status', 'einvoicing.configure',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete', 'clients.export',
    'catalog.view', 'catalog.edit', 'catalog.delete',
    'chantiers.view', 'chantiers.create', 'chantiers.edit', 'chantiers.delete',
    'chantiers.pointage', 'chantiers.manage_team',
    'chantiers.view_tasks', 'chantiers.manage_tasks',
    'leads.view', 'leads.manage',
    'team.view', 'team.invite', 'team.manage', 'team.edit_roles', 'team.remove_members',
    'reminders.view', 'reminders.send_manual', 'reminders.configure_auto',
    'settings.view', 'settings.edit', 'settings.edit_org', 'settings.edit_branding',
    'settings.edit_emails', 'settings.edit_goals', 'settings.edit_roles',
    'import.clients', 'import.history',
    'reports.view'
  ];
  commercial_perms TEXT[] := ARRAY[
    'dashboard.view', 'dashboard.view_ca',
    'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.send', 'quotes.convert_invoice',
    'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.send',
    'clients.view', 'clients.create', 'clients.edit',
    'catalog.view', 'catalog.edit',
    'chantiers.view', 'chantiers.pointage', 'chantiers.view_tasks',
    'leads.view', 'leads.manage',
    'team.view',
    'reminders.view', 'reminders.send_manual',
    'settings.view',
    'reports.view'
  ];
  viewer_perms TEXT[] := ARRAY[
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view',
    'chantiers.view',
    'team.view',
    'settings.view'
  ];
BEGIN
  FOR r IN
    SELECT id, slug FROM public.roles WHERE slug != 'owner'
  LOOP
    -- Supprimer toutes les permissions existantes du rôle
    DELETE FROM public.role_permissions WHERE role_id = r.id;

    -- Réinsérer selon le slug
    IF r.slug = 'admin' THEN
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(admin_perms), true;

    ELSIF r.slug = 'manager' THEN
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(manager_perms), true;

    ELSIF r.slug = 'commercial' THEN
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(commercial_perms), true;

    ELSIF r.slug IN ('employee', 'collaborateur') THEN
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(collab_perms), true;

    ELSIF r.slug = 'viewer' THEN
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(viewer_perms), true;

    ELSE
      -- Rôle personnalisé : accorder les permissions collab par défaut
      INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
      SELECT r.id, unnest(collab_perms), true;
    END IF;

  END LOOP;
END;
$$;

-- ----------------------------------------------------------
-- 3. Mettre à jour initialize_organization_for_user
--    pour que les nouvelles orgs reçoivent les mêmes permissions
-- ----------------------------------------------------------
-- DROP requis car PostgreSQL interdit CREATE OR REPLACE si le type de retour change
DROP FUNCTION IF EXISTS public.initialize_organization_for_user(UUID, TEXT, TEXT);

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
  v_org_name := COALESCE(p_full_name, 'Mon Entreprise');
  v_slug := lower(
    regexp_replace(COALESCE(p_full_name, 'entreprise'), '[^a-zA-Z0-9]+', '-', 'g')
  ) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO public.organizations (name, slug, email, sector, join_code)
  VALUES (v_org_name, v_slug, COALESCE(p_email, ''), 'other', public.generate_join_code())
  RETURNING id INTO v_org_id;

  -- Rôles
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

  -- Technicien (employee) & Collaborateur : même permissions larges
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_employee_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca',
    'quotes.view','quotes.create','quotes.edit','quotes.send',
    'invoices.view','invoices.create','invoices.edit','invoices.send',
    'clients.view','clients.create','clients.edit',
    'catalog.view','catalog.edit',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.pointage',
    'chantiers.view_tasks','chantiers.manage_tasks',
    'leads.view','leads.manage',
    'team.view','reminders.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_collab_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca',
    'quotes.view','quotes.create','quotes.edit','quotes.send',
    'invoices.view','invoices.create','invoices.edit','invoices.send',
    'clients.view','clients.create','clients.edit',
    'catalog.view','catalog.edit',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.pointage',
    'chantiers.view_tasks','chantiers.manage_tasks',
    'leads.view','leads.manage',
    'team.view','reminders.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Lecteur
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_viewer_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view','invoices.view','clients.view','catalog.view',
    'chantiers.view','team.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES (v_org_id, p_user_id, v_owner_role_id, now(), true);

END;
$$;
