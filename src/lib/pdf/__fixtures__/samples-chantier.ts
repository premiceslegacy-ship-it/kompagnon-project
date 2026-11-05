// Jeux d'essai du contrat, du DGD et du rapport de chantier (courts et longs).
import type { ChantierDetail, ChantierNote, Tache } from '@/lib/data/queries/chantiers'
import { CONTRACT_TEMPLATES, interpolateClauses } from '@/lib/contracts/templates'
import type { ChantierPdfData } from '../documents/chantier'
import type { ContractPdfSnapshot } from '../documents/contract'
import type { DgdPdfData } from '../documents/dgd'
import { SAMPLE_LOGO_PNG } from './logo'
import { organization } from './samples'

export function contractSnapshot(long: boolean): ContractPdfSnapshot {
  const template = CONTRACT_TEMPLATES.find(t => t.type === (long ? 'sous_traitance' : 'maintenance'))!
  const clauses = interpolateClauses(template.clauses, {
    donneurOrdre: long ? 'Bâtir Rhône SAS' : 'SCI Les Tilleuls',
    soustraitant: organization.name,
    chantier: long ? 'Résidence Les Platanes' : 'Immeuble Les Tilleuls',
  })
  return {
    generatedAt: '2026-11-01T09:00:00Z',
    reference: long ? 'CT-2026-012' : 'C-2026-007',
    contract: {
      id: 'contract-1',
      title: template.title,
      type: template.type,
      role: 'sous_traitant',
      status: 'sent',
      templateTitle: template.title,
      clauses,
      customSections: long ? [{ id: 'cs-1', title: 'Accès au site', content: "Le site est accessible du lundi au vendredi de 7 h 30 à 17 h. Les badges sont remis par le conducteur de travaux contre signature.\n\nToute intervention hors de ces horaires fait l'objet d'une demande écrite 48 heures à l'avance." }] : [],
    },
    organization: {
      ...organization,
      logo_url: long ? SAMPLE_LOGO_PNG : null,
      signatory_name: 'Samuel Mbeboura',
      signatory_role: 'Gérant',
      signature_image: null,
    },
    counterparty: {
      name: long ? 'Bâtir Rhône SAS' : 'SCI Les Tilleuls',
      email: long ? 'achats@batir-rhone.fr' : 'gestion@sci-tilleuls.fr',
      phone: '04 78 12 34 56',
      address: long ? '58 cours Lafayette, 69003 Lyon' : '4 rue Béchevelin, 69007 Lyon',
      signatory_name: long ? 'Claire Morel' : null,
      signatory_role: long ? 'Directrice des achats' : null,
      signed_at: null,
      client: { siret: '812 345 678 00021', vat_number: 'FR45812345678', contact_name: 'Mme Roche' },
    },
    chantier: long
      ? { title: 'Résidence Les Platanes, lot plomberie', address_line1: '14 avenue des Platanes', postal_code: '69200', city: 'Vénissieux', start_date: '2026-11-16', estimated_end_date: '2027-02-26', budget_ht: 48500 }
      : null,
  }
}

export function dgdData(long: boolean): DgdPdfData {
  const lines: DgdPdfData['lines'] = [
    { label: 'Marche initial', reference: 'D-114', amount_ht: 7655, net_ht: 7655, type: 'marche' },
    { label: 'Dalle béton supplémentaire', reference: 'D-114-A1', amount_ht: 840, net_ht: 840, type: 'avenant' },
    { label: 'Situation n° 1', reference: 'F-040', date: '2026-10-01', amount_ht: 4000, retention_pct: 5, retention_amount: 200, net_ht: 3800, cumulative_pct: 47, type: 'situation' },
    ...(long
      ? [
          { label: 'Situation n° 2', reference: 'F-041', date: '2026-10-15', amount_ht: 2000, retention_pct: 5, retention_amount: 100, net_ht: 1900, cumulative_pct: 71, type: 'situation' as const },
          { label: 'Situation n° 3, reprise des enduits du couloir et des embrasures', reference: 'F-043', date: '2026-10-25', amount_ht: 1200, retention_pct: 5, retention_amount: 60, net_ht: 1140, cumulative_pct: 85, type: 'situation' as const },
        ]
      : []),
    { label: 'Facture de solde', reference: 'F-044', date: '2026-11-01', amount_ht: long ? 1295 : 4495, retention_pct: 5, retention_amount: long ? 64.75 : 224.75, net_ht: long ? 1230.25 : 4270.25, cumulative_pct: 100, type: 'solde' },
  ]
  const totalSituationsHt = lines.filter(l => l.type === 'situation' || l.type === 'solde').reduce((s, l) => s + l.amount_ht, 0)
  const totalRetentionHt = lines.reduce((s, l) => s + (l.retention_amount ?? 0), 0)
  lines.push({ label: 'TOTAL GENERAL', amount_ht: totalSituationsHt, retention_amount: totalRetentionHt, net_ht: totalSituationsHt - totalRetentionHt, type: 'total' })
  return {
    chantierTitle: 'Salle de bain Dupont',
    chantierAddress: '12 rue des Lilas, 69003, Lyon',
    clientName: 'Dupont Rénovation',
    marketReference: 'M-2026-018',
    lines,
    totalMarcheHt: 8495,
    totalSituationsHt,
    totalRetentionHt,
    totalNetHt: totalSituationsHt - totalRetentionHt,
    receptionDate: '2026-10-30',
    receptionStatus: 'sans_reserve',
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    editedAt: '2026-11-01T09:00:00Z',
  }
}

const TASKS: [string, Tache['status'], string, string?][] = [
  ['Dépose du carrelage existant', 'termine', '2026-10-08'],
  ['Plomberie encastrée', 'termine', '2026-10-10', 'Nourrices remplacées, essai en pression validé.'],
  ['Ragréage du sol', 'termine', '2026-10-13'],
  ['Pose du carrelage', 'en_cours', '2026-11-06', 'Murs terminés, sol à 60 %.'],
  ['Meuble vasque et robinetterie', 'a_faire', '2026-11-09'],
  ['Joints et finitions', 'a_faire', '2026-11-12'],
  ['Réception avec le client', 'a_faire', '2026-11-16'],
]

export function chantierData(long: boolean): ChantierPdfData {
  const list = long ? [...TASKS, ...TASKS.map(([t, s, d]) => [`${t}, étage 2`, s, d] as typeof TASKS[number])] : TASKS
  const taches: Tache[] = list.map(([title, status, due, note], i) => ({
    id: `t-${i}`, chantier_id: 'ch-1', title, description: long && i % 3 === 0 ? 'Prévoir la protection des sols de la circulation avant intervention.' : null,
    progress_note: note ?? null, status, position: i, assigned_to: null, due_date: due, completed_at: null, created_at: '2026-10-01T08:00:00Z', jalon_id: null, assignments: [],
  }))
  const done = taches.filter(t => t.status === 'termine').length
  const chantier = {
    id: 'ch-1', title: 'Salle de bain Dupont', description: null, status: 'en_cours',
    address_line1: '12 rue des Lilas', postal_code: '69003', city: 'Lyon',
    start_date: '2026-10-08', end_date: null, estimated_end_date: '2026-11-16', budget_ht: 7655, target_margin_pct: 30,
    montant_periode_ht: null, libelle_facturation_periode: null, periode_facturation: null, jour_facturation: null, prochaine_facturation: null,
    default_retention_pct: 5, quote_id: 'quote-short', created_at: '2026-10-01T08:00:00Z',
    reception_status: null, reception_at: null, reception_notes: null,
    contact_name: 'Jean Dupont', contact_email: 'jean.dupont@dupont-renovation.fr', contact_phone: '06 98 76 54 32',
    recurrence: null, recurrence_times: null, recurrence_team_size: null, recurrence_duration_h: null, recurrence_notes: null,
    client: { id: 'client-1', company_name: 'Dupont Rénovation', email: 'jean.dupont@dupont-renovation.fr' },
    taches_count: taches.length, taches_done: done, total_hours: 96, photos_count: 3,
  } as ChantierDetail
  const notes: ChantierNote[] = long
    ? [
        { id: 'n1', chantier_id: 'ch-1', content: 'Livraison du carrelage reçue, deux cartons abîmés remplacés par le fournisseur.', created_at: '2026-10-14T16:00:00Z', author_name: 'Karim Benali' },
        { id: 'n2', chantier_id: 'ch-1', content: 'Le client souhaite décaler la pose du meuble vasque au 9 novembre. Accord donné, planning mis à jour.', created_at: '2026-10-28T11:30:00Z', author_name: 'Samuel Mbeboura' },
      ]
    : []
  const photo = SAMPLE_LOGO_PNG
  return {
    chantier, taches, notes,
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    periodFrom: long ? '2026-10-01' : null,
    periodTo: long ? '2026-10-31' : null,
    reportPhotos: [
      { id: 'p1', url: photo, title: 'Avant les travaux', caption: long ? 'Salle de bain d\'origine, carrelage des années 1980.' : null },
      { id: 'p2', url: photo, title: 'Plomberie', caption: null },
      { id: 'p3', url: photo, title: 'Ragréage', caption: null },
    ],
    editedAt: '2026-11-01T09:00:00Z',
  }
}
