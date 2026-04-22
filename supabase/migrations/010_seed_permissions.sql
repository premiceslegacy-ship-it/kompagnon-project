-- ============================================================
-- 010_seed_permissions.sql
-- Données de référence : toutes les permissions de l'application
-- ⚠️  DOIT être exécuté AVANT le premier signup utilisateur
--     (initialize_organization_for_user en a besoin pour les role_permissions)
-- ============================================================

-- Insertion idempotente (ON CONFLICT DO UPDATE permet le re-run sans erreur)
INSERT INTO public.permissions (key, label, category, position) VALUES

  -- ── Devis ──────────────────────────────────────────────────────────────────
  ('quotes.view',            'Voir les devis',             'quotes', 1),
  ('quotes.create',          'Créer des devis',            'quotes', 2),
  ('quotes.edit',            'Modifier des devis',         'quotes', 3),
  ('quotes.send',            'Envoyer des devis',          'quotes', 4),
  ('quotes.delete',          'Supprimer des devis',        'quotes', 5),
  ('quotes.convert_invoice', 'Convertir en facture',       'quotes', 6),

  -- ── Factures ───────────────────────────────────────────────────────────────
  ('invoices.view',           'Voir les factures',              'invoices', 1),
  ('invoices.create',         'Créer des factures',             'invoices', 2),
  ('invoices.edit',           'Modifier des factures',          'invoices', 3),
  ('invoices.send',           'Envoyer des factures',           'invoices', 4),
  ('invoices.delete',         'Supprimer des factures',         'invoices', 5),
  ('invoices.record_payment', 'Enregistrer un paiement',        'invoices', 6),
  ('invoices.create_credit',  'Créer un avoir',                 'invoices', 7),
  ('received_invoices.view',  'Voir les factures reçues',       'invoices', 8),
  ('received_invoices.process','Traiter les factures reçues',   'invoices', 9),
  ('received_invoices.reject', 'Rejeter une facture reçue',     'invoices', 10),
  ('einvoicing.view_status',  'Voir les statuts de transmission','invoices', 11),

  -- ── Clients ────────────────────────────────────────────────────────────────
  ('clients.view',   'Voir les clients',          'clients', 1),
  ('clients.create', 'Créer des clients',         'clients', 2),
  ('clients.edit',   'Modifier des clients',      'clients', 3),
  ('clients.delete', 'Supprimer des clients',     'clients', 4),
  ('clients.export', 'Exporter la liste clients', 'clients', 5),

  -- ── Relances ───────────────────────────────────────────────────────────────
  ('reminders.view',            'Voir les relances',             'reminders', 1),
  ('reminders.send_manual',     'Envoyer des relances manuelles','reminders', 2),
  ('reminders.configure_auto',  'Configurer les relances auto',  'reminders', 3),

  -- ── Catalogue ──────────────────────────────────────────────────────────────
  ('catalog.view',   'Voir le catalogue',    'catalog', 1),
  ('catalog.edit',   'Modifier le catalogue','catalog', 2),
  ('catalog.delete', 'Supprimer du catalogue','catalog', 3),

  -- ── Dashboard ──────────────────────────────────────────────────────────────
  ('dashboard.view',       'Voir le tableau de bord', 'dashboard', 0),
  ('dashboard.view_ca',    'Voir le CA',              'dashboard', 1),
  ('dashboard.view_goals', 'Voir les objectifs',      'dashboard', 2),
  ('dashboard.set_goals',  'Définir les objectifs',   'dashboard', 3),

  -- ── Import ─────────────────────────────────────────────────────────────────
  ('import.clients', 'Importer des clients',     'import', 1),
  ('import.history', 'Importer l''historique',   'import', 2),

  -- ── Équipe ─────────────────────────────────────────────────────────────────
  ('team.manage',        'Gérer l''équipe',       'team', 0),
  ('team.view',          'Voir l''équipe',         'team', 1),
  ('team.invite',        'Inviter des membres',    'team', 2),
  ('team.edit_roles',    'Modifier les rôles',     'team', 3),
  ('team.remove_members','Retirer des membres',    'team', 4),

  -- ── Paramètres ─────────────────────────────────────────────────────────────
  ('settings.edit',         'Modifier les paramètres',          'settings', 0),
  ('settings.view',         'Voir les paramètres',              'settings', 1),
  ('settings.edit_org',     'Modifier les infos légales',       'settings', 2),
  ('settings.edit_branding','Modifier le branding',             'settings', 3),
  ('settings.edit_emails',  'Modifier les templates emails',    'settings', 4),
  ('settings.edit_goals',   'Configurer les objectifs',         'settings', 5),
  ('settings.edit_roles',   'Configurer les rôles',             'settings', 6),
  ('einvoicing.configure',  'Configurer la PA (B2Brouter)',     'settings', 7),

  -- ── Rapports ───────────────────────────────────────────────────────────────
  ('reports.view', 'Voir les rapports', 'reports', 0)

ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;
