// Traductions des statuts techniques en libellés français.
// À utiliser partout où un statut base de données peut être montré à un
// utilisateur ou injecté dans un prompt IA : aucun assistant ne doit jamais
// afficher un code brut type "en_cours" ou "sent".

export const CHANTIER_STATUS_LABELS: Record<string, string> = {
  brouillon: 'brouillon',
  planifie: 'planifié',
  en_cours: 'en cours',
  suspendu: 'suspendu',
  termine: 'terminé',
  annule: 'annulé',
}

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'brouillon',
  sent: 'envoyé',
  viewed: 'consulté par le client',
  signed: 'signé',
  accepted: 'accepté',
  refused: 'refusé',
  expired: 'expiré',
  cancelled: 'annulé',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'brouillon',
  sent: 'envoyée',
  paid: 'payée',
  partial: 'partiellement payée',
  overdue: 'en retard',
  cancelled: 'annulée',
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  a_faire: 'à faire',
  en_cours: 'en cours',
  termine: 'terminée',
}

export function humanStatus(map: Record<string, string>, status: string | null | undefined): string | null {
  if (!status) return null
  return map[status] ?? status.replace(/_/g, ' ')
}
