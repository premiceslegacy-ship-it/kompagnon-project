-- Corrige initialize_organization_for_user : la version en base référence
-- organizations.owner_id et memberships.status, deux colonnes qui n'existent
-- pas dans le schéma réel (organizations n'a jamais eu owner_id, memberships
-- a is_active/accepted_at, pas status). Confirmé en base par pg_get_functiondef
-- + information_schema.columns le 2026-08-08 : tout signup échoue aujourd'hui
-- avec "column owner_id of relation organizations does not exist".
-- Testée en base après premier correctif : slug et join_code sont NOT NULL
-- sans défaut sur organizations, et n'étaient plus renseignés dans les
-- révisions 094/097/146 — repris de la version originale (006_functions.sql)
-- qui générait un slug temporaire + join_code via generate_join_code().
-- Corps repris à l'identique par ailleurs (7 rôles + matrice role_permissions
-- complète de la version 146, plus riche que la 006).

CREATE OR REPLACE FUNCTION public.initialize_organization_for_user(p_user_id uuid, p_full_name text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id              UUID;
  v_owner_role_id       UUID;
  v_admin_role_id       UUID;
  v_manager_role_id     UUID;
  v_commercial_role_id  UUID;
  v_employee_role_id    UUID;
  v_collab_role_id      UUID;
  v_viewer_role_id      UUID;
  v_slug                TEXT;
BEGIN
  v_slug := lower(
    regexp_replace(COALESCE(p_full_name, 'entreprise'), '[^a-zA-Z0-9]+', '-', 'g')
  ) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO public.organizations (name, slug, email, sector, join_code)
  VALUES ('Mon Atelier', v_slug, COALESCE(p_email, ''), 'other', public.generate_join_code())
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

  -- Admin : tout sauf ai.sarah (accordé manuellement par l'owner)
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_admin_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca','dashboard.view_goals','dashboard.set_goals',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.delete','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.delete',
    'invoices.record_payment','invoices.create_credit','invoices.create_situation','invoices.create_solde',
    'received_invoices.view','received_invoices.process','received_invoices.reject',
    'einvoicing.view_status','einvoicing.configure',
    'clients.view','clients.create','clients.edit','clients.delete','clients.export',
    'catalog.view','catalog.create','catalog.edit','catalog.delete',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.delete',
    'chantiers.pointage','chantiers.manage_team','chantiers.view_tasks','chantiers.manage_tasks',
    'chantiers.planning','chantiers.profitability.view',
    'chantiers.expenses.view','chantiers.expenses.create','chantiers.expenses.edit','chantiers.expenses.delete',
    'chantiers.manage_pointages',
    'leads.view','leads.manage',
    'contracts.view','contracts.create','contracts.edit','contracts.delete',
    'team.view','team.invite','team.manage','team.edit_roles','team.remove_members',
    'reminders.view','reminders.send_manual','reminders.configure_auto',
    'settings.view','settings.edit','settings.edit_org','settings.edit_branding',
    'settings.edit_emails','settings.edit_goals','settings.edit_roles',
    'import.clients','import.history','reports.view',
    'ai.manage','ai.terrain'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Manager : pilotage opérationnel, pas sarah ni settings avancés
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_manager_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca','dashboard.view_goals','dashboard.set_goals',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.delete','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.delete',
    'invoices.record_payment','invoices.create_credit',
    'received_invoices.view','received_invoices.process',
    'clients.view','clients.create','clients.edit','clients.delete','clients.export',
    'catalog.view','catalog.create','catalog.edit','catalog.delete',
    'chantiers.view','chantiers.create','chantiers.edit','chantiers.delete',
    'chantiers.pointage','chantiers.manage_team','chantiers.view_tasks','chantiers.manage_tasks',
    'chantiers.planning','chantiers.profitability.view',
    'chantiers.expenses.view','chantiers.expenses.create','chantiers.expenses.edit','chantiers.expenses.delete',
    'chantiers.manage_pointages',
    'leads.view','leads.manage',
    'contracts.view','contracts.create','contracts.edit',
    'team.view','team.invite','team.manage',
    'reminders.view','reminders.send_manual','reminders.configure_auto',
    'settings.view','settings.edit','settings.edit_org','settings.edit_branding',
    'settings.edit_emails','settings.edit_goals',
    'import.clients','import.history','reports.view',
    'ai.manage','ai.terrain'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Commercial : devis/factures/clients + IA manage (devis IA utile) + terrain
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_commercial_role_id, key, CASE WHEN key IN (
    'dashboard.view','dashboard.view_ca',
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send',
    'clients.view','clients.create','clients.edit',
    'catalog.view','catalog.create','catalog.edit',
    'chantiers.view','chantiers.pointage','chantiers.view_tasks',
    'chantiers.expenses.view','chantiers.expenses.create',
    'leads.view','leads.manage',
    'contracts.view','contracts.create',
    'team.view',
    'reminders.view','reminders.send_manual',
    'settings.view','reports.view',
    'ai.manage','ai.terrain'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Technicien : terrain uniquement — pas de pilotage IA
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_employee_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view','catalog.create','catalog.edit',
    'chantiers.view','chantiers.create','chantiers.pointage',
    'chantiers.view_tasks','chantiers.manage_tasks',
    'chantiers.expenses.view','chantiers.expenses.create',
    'leads.view',
    'team.view','reminders.view','settings.view',
    'ai.terrain'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Collaborateur : terrain allégé
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_collab_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view',
    'invoices.view',
    'clients.view',
    'catalog.view',
    'chantiers.view','chantiers.pointage',
    'chantiers.view_tasks',
    'chantiers.expenses.view','chantiers.expenses.create',
    'team.view','reminders.view','settings.view',
    'ai.terrain'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Lecteur : lecture seule, pas d'IA
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  SELECT v_viewer_role_id, key, CASE WHEN key IN (
    'dashboard.view',
    'quotes.view','invoices.view','clients.view','catalog.view',
    'chantiers.view','chantiers.view_tasks',
    'team.view','settings.view'
  ) THEN true ELSE false END
  FROM public.permissions;

  -- Membership owner
  INSERT INTO public.memberships (organization_id, user_id, role_id, is_active, accepted_at)
  VALUES (v_org_id, p_user_id, v_owner_role_id, true, now());

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (p_user_id, p_full_name, p_email)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

END;
$function$
