/**
 * Dictionnaire central FR des permissions et catégories.
 * Sert de source de vérité pour l'UI Settings > Rôles.
 *
 * Ordre de priorité d'affichage : PERMISSION_LABELS > permission.label (DB) > permission.key
 * Si une permission est ajoutée à la DB sans label, on fallback ici.
 */

export const PERMISSION_LABELS: Record<string, string> = {
  // ─── Devis ────────────────────────────────────────────────────────────────
  'quotes.view':            'Voir les devis',
  'quotes.create':          'Créer des devis',
  'quotes.edit':            'Modifier des devis',
  'quotes.send':            'Envoyer des devis',
  'quotes.delete':          'Supprimer des devis',
  'quotes.convert_invoice': 'Convertir un devis en facture',

  // ─── Factures ─────────────────────────────────────────────────────────────
  'invoices.view':           'Voir les factures',
  'invoices.create':         'Créer des factures',
  'invoices.edit':           'Modifier des factures',
  'invoices.send':           'Envoyer des factures',
  'invoices.delete':         'Supprimer des factures',
  'invoices.record_payment': 'Enregistrer un paiement',
  'invoices.create_credit':  'Créer un avoir',
  'received_invoices.view':  'Voir les factures reçues',
  'received_invoices.process':'Traiter les factures reçues',
  'received_invoices.reject':'Rejeter une facture reçue',
  'einvoicing.view_status':  'Voir les statuts de transmission',

  // ─── Clients ──────────────────────────────────────────────────────────────
  'clients.view':   'Voir les clients',
  'clients.create': 'Créer des clients',
  'clients.edit':   'Modifier des clients',
  'clients.delete': 'Supprimer des clients',
  'clients.export': 'Exporter la liste clients',

  // ─── Relances ─────────────────────────────────────────────────────────────
  'reminders.view':            'Voir les relances',
  'reminders.send_manual':     'Envoyer des relances manuelles',
  'reminders.configure_auto':  'Configurer les relances automatiques',

  // ─── Catalogue ────────────────────────────────────────────────────────────
  'catalog.view':   'Voir le catalogue',
  'catalog.create': 'Ajouter au catalogue',
  'catalog.edit':   'Modifier le catalogue',
  'catalog.delete': 'Supprimer du catalogue',

  // ─── Tableau de bord ──────────────────────────────────────────────────────
  'dashboard.view':       'Voir le tableau de bord',
  'dashboard.view_ca':    'Voir le chiffre d’affaires',
  'dashboard.view_goals': 'Voir les objectifs',
  'dashboard.set_goals':  'Définir les objectifs',

  // ─── Imports ──────────────────────────────────────────────────────────────
  'import.clients': 'Importer des clients',
  'import.history': 'Importer l’historique',

  // ─── Équipe ───────────────────────────────────────────────────────────────
  'team.manage':         'Gérer l’équipe',
  'team.view':           'Voir l’équipe',
  'team.invite':         'Inviter des membres',
  'team.edit_roles':     'Modifier les rôles',
  'team.remove_members': 'Retirer des membres',

  // ─── Paramètres ───────────────────────────────────────────────────────────
  'settings.edit':          'Modifier les paramètres',
  'settings.view':          'Voir les paramètres',
  'settings.edit_org':      'Modifier les infos légales',
  'settings.edit_branding': 'Modifier le branding',
  'settings.edit_emails':   'Modifier les modèles d’emails',
  'settings.edit_goals':    'Configurer les objectifs',
  'settings.edit_roles':    'Configurer les rôles',
  'einvoicing.configure':   'Configurer la facturation électronique (B2Brouter)',

  // ─── Chantiers ────────────────────────────────────────────────────────────
  'chantiers.view':         'Voir les chantiers',
  'chantiers.create':       'Créer des chantiers',
  'chantiers.edit':         'Modifier des chantiers',
  'chantiers.delete':       'Supprimer des chantiers',
  'chantiers.pointage':     'Pointer ses heures',
  'chantiers.manage_team':  'Gérer l’équipe d’un chantier',
  'chantiers.view_tasks':   'Voir les tâches',
  'chantiers.manage_tasks': 'Gérer les tâches',
  'chantiers.expenses.view':   'Voir les dépenses chantier',
  'chantiers.expenses.create': 'Ajouter des dépenses chantier',
  'chantiers.expenses.edit':   'Modifier des dépenses chantier',
  'chantiers.expenses.delete': 'Supprimer des dépenses chantier',

  // ─── Demandes (leads) ─────────────────────────────────────────────────────
  'leads.view':   'Voir les demandes',
  'leads.manage': 'Traiter et gérer les demandes',

  // ─── Rapports ─────────────────────────────────────────────────────────────
  'reports.view': 'Voir les rapports',
}

export const CATEGORY_LABELS: Record<string, string> = {
  quotes:     'Devis',
  invoices:   'Factures',
  clients:    'Clients',
  reminders:  'Relances',
  catalog:    'Catalogue',
  dashboard:  'Tableau de bord',
  import:     'Imports',
  team:       'Équipe',
  settings:   'Paramètres',
  chantiers:  'Chantiers',
  leads:      'Demandes',
  reports:    'Rapports',
}

/** Helper : retourne le label FR final avec fallbacks. */
export function permissionLabel(key: string, dbLabel?: string | null): string {
  return PERMISSION_LABELS[key] ?? dbLabel ?? prettify(key)
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? prettify(slug)
}

/** Convertit "catalog.delete" → "Catalog delete" si vraiment rien dans le dict. */
function prettify(s: string): string {
  return s
    .replace(/[._]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
}
