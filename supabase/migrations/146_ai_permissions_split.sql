-- ============================================================
-- 146_ai_permissions_split.sql
--
-- Découpage de ai.sarah en 3 permissions IA distinctes :
--
--   ai.sarah   — widget Sarah (chatbot texte + vocal ElevenLabs + brief quotidien)
--               owner + 1 membre max (inchangé)
--
--   ai.manage  — IA de pilotage (devis IA, planning IA, relances, imports docs,
--               rapports chantier PDF, estimation MO)
--               owner, admin, manager par défaut
--
--   ai.terrain — IA terrain (suggestions tâches, assistant chantier Marco,
--               scan ticket OCR, saisie vocale, catalogue Léa)
--               technicien, collaborateur + tous les rôles au-dessus
--
-- La rédaction emails clients IA (email_draft) ne nécessite pas de permission IA :
-- elle est gatée uniquement par le module relances_ai + reminders.send_manual.
-- ============================================================

-- ----------------------------------------------------------
-- 1. Créer les nouvelles permissions
-- ----------------------------------------------------------
INSERT INTO public.permissions (key, label, category, position)
VALUES
  ('ai.manage',  'IA de pilotage (devis, planning, relances, imports, rapports)', 'ai', 2),
  ('ai.terrain', 'IA terrain (assistant chantier, OCR, saisie vocale, catalogue)', 'ai', 3)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- Mettre à jour le label ai.sarah pour clarifier son périmètre
UPDATE public.permissions
SET label = 'Sarah — widget secrétaire IA (chatbot texte + vocal ElevenLabs)'
WHERE key = 'ai.sarah';

-- ----------------------------------------------------------
-- 2. Attribuer les permissions aux rôles dans toutes les orgs
-- ----------------------------------------------------------

-- ai.manage : owner (déjà via '*'), admin, manager
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, 'ai.manage', true
FROM public.roles r
WHERE r.slug IN ('owner', 'admin', 'manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'ai.manage'
  );

-- ai.terrain : owner (déjà via '*'), admin, manager, commercial, employee, collaborateur
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, 'ai.terrain', true
FROM public.roles r
WHERE r.slug IN ('owner', 'admin', 'manager', 'commercial', 'employee', 'collaborateur')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'ai.terrain'
  );

-- ----------------------------------------------------------
-- 3. Mettre à jour initialize_organization_for_user
--    pour que les nouvelles orgs reçoivent les bonnes permissions
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
  INSERT INTO public.memberships (organization_id, user_id, role_id, status)
  VALUES (v_org_id, p_user_id, v_owner_role_id, 'active');

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (p_user_id, p_full_name, p_email)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

END;
$$;
