// Jeux d'essai des rapports (mensuel, intervention, heures, tournée, indicateurs), courts et longs.
import type { IndividualMember, MemberPointage } from '@/lib/data/queries/members'
import type { AnnualReport, MonthlyReport } from '@/lib/data/queries/reporting'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import type { MaintenanceInterventionPdfData } from '../documents/maintenance-intervention'
import type { MemberHoursReportPdfData } from '../documents/member-hours-report'
import type { MonthlyReportData, ReportInvoice, ReportQuote } from '../documents/monthly-report'
import type { RapportKpiPdfData } from '../documents/rapport-kpi'
import type { TourneePdfData } from '../documents/tournee'
import { SAMPLE_LOGO_PNG } from './logo'
import { organization } from './samples'

const CLIENTS = ['Martin & Fils', 'Bernard Toiture', 'Dupont Rénovation', 'Atelier Leroy', 'SCI Les Tilleuls', 'Mme Garnier']

export function monthlyReportData(long: boolean): MonthlyReportData {
  const statuses = ['paid', 'paid', 'sent', 'overdue', 'partial', 'paid', 'viewed', 'draft']
  const count = long ? 16 : 4
  const invoices: ReportInvoice[] = Array.from({ length: count }, (_, i) => {
    const ht = 1200 + ((i * 977) % 2600)
    const status = statuses[i % statuses.length]
    const day = String(2 + ((i * 3) % 27)).padStart(2, '0')
    return {
      id: `inv-${i}`, number: `F-${String(39 + i).padStart(3, '0')}`, title: null, status, invoice_type: 'standard',
      total_ht: ht, total_tva: ht * 0.1, total_ttc: ht * 1.1, total_paid: status === 'partial' ? ht * 0.5 : 0, currency: 'EUR',
      issue_date: `2026-10-${day}`, due_date: null, paid_at: status === 'paid' ? `2026-10-${day}T10:00:00Z` : null,
      created_at: `2026-10-${day}T09:00:00Z`, client_name: CLIENTS[i % CLIENTS.length], items_cost_total: ht * 0.62,
      payments: status === 'partial' ? [{ id: `pay-${i}`, amount: ht * 0.55, payment_date: '2026-10-28' }] : [],
    }
  })
  const qStatus = ['accepted', 'sent', 'refused', 'accepted', 'draft', 'converted']
  const quotes: ReportQuote[] = Array.from({ length: long ? 14 : 3 }, (_, i) => ({
    id: `q-${i}`, number: `D-${110 + i}`, title: ['Salle de bain', 'Terrasse bois', 'Zinguerie', 'Cuisine complète avec reprise des réseaux'][i % 4],
    status: qStatus[i % qStatus.length], total_ht: 2400 + i * 310, currency: 'EUR', created_at: `2026-10-${String(3 + i).padStart(2, '0')}T09:00:00Z`,
    client_name: CLIENTS[(i + 2) % CLIENTS.length],
  }))
  return {
    month: '2026-10',
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    invoices,
    quotes,
    editedAt: '2026-11-01T09:00:00Z',
  }
}

export function maintenanceData(long: boolean): MaintenanceInterventionPdfData {
  return {
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    intervention: {
      id: 'int-1', date_intervention: '2026-10-28', statut: 'termine', start_time: '09:00:00', end_time: '11:30:00', duration_hours: 2.5,
      rapport: [
        'Nettoyage du corps de chauffe', 'Contrôle des organes de sécurité', 'Réglage de la combustion',
        'Vérification du vase d\'expansion', 'Test du circuit d\'évacuation', 'Purge des radiateurs du 1er étage',
        ...(long ? ['Remplacement du joint de la vanne de purge', 'Contrôle de la ventilation de la chaufferie'] : []),
      ].join('\n'),
      observations: long
        ? "Installation en bon état. Le joint de la vanne de purge du 1er étage a été remplacé. Prévoir le remplacement du circulateur lors de la prochaine visite : bruit anormal au démarrage. Nous recommandons également un désembouage du réseau avant l'hiver prochain."
        : 'Installation en bon état. Le joint de la vanne de purge du 1er étage sera remplacé lors de la prochaine visite.',
      billable_notes: null, cost_parts_ht: null, cost_travel_ht: null, cost_other_ht: null, billable_amount_ht: null,
      intervenant: { prenom: 'Karim', name: 'Benali' },
      intervenant_profile: null,
      invoice: null,
      contract: {
        title: 'Entretien chaufferie collective', frequence: 'semestrielle', site_name: 'Chaufferie collective',
        site_contact_name: 'Mme Roche', site_contact_email: null, site_contact_phone: '06 98 76 54 32',
        site_address_line1: '4 rue Béchevelin', site_postal_code: '69007', site_city: 'Lyon',
        equipements: long
          ? [{ nom: 'Chaudière gaz à condensation', ref: 'Viessmann Vitodens 200', localisation: 'Sous-sol' }, { nom: 'Vase d\'expansion', ref: '80 L', localisation: 'Sous-sol' }, { nom: 'Extracteur', ref: 'VMC-2', localisation: 'Toiture' }]
          : [],
        client: { company_name: 'SCI Les Tilleuls', address_line1: '4 rue Béchevelin', postal_code: '69007', city: 'Lyon' },
        chantier: null,
      },
    },
    reportPhotos: long ? [{ id: 'p1', url: SAMPLE_LOGO_PNG, title: 'Brûleur après nettoyage', caption: null }, { id: 'p2', url: SAMPLE_LOGO_PNG, title: 'Vanne de purge', caption: 'Joint remplacé' }] : [],
  }
}

export function memberHoursData(long: boolean): MemberHoursReportPdfData {
  const member: IndividualMember = { id: 'm1', organization_id: 'org-1', equipe_id: null, prenom: 'Karim', name: 'Benali', email: 'karim.benali@atelier-mbeboura.fr', role_label: 'Plombier chauffagiste', taux_horaire: 38, profile_id: null, created_at: '2026-01-01T00:00:00Z' }
  const sites = ['Salle de bain Dupont', 'Terrasse bois Martin', 'Zinguerie Bernard', 'Cuisine Garnier', 'Chaufferie Les Tilleuls', 'Résidence Les Platanes, lot plomberie']
  const pointages: MemberPointage[] = Array.from({ length: long ? 40 : 8 }, (_, i) => ({
    id: `pt-${i}`, chantier_id: `c-${i % (long ? 6 : 3)}`, chantier_title: sites[i % (long ? 6 : 3)], tache_id: null, tache_title: null,
    date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, hours: i % 5 === 4 ? 4 : 8, start_time: '08:00:00', description: null,
    rate_snapshot: long && i % 4 === 3 ? 45 : 38,
  }))
  return {
    member,
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    pointages,
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    totalHours: pointages.reduce((s, p) => s + p.hours, 0),
    isAppMember: false,
  }
}

export function tourneeData(long: boolean): TourneePdfData {
  const stops: [string, string, string, string, string, number, number | null, string | null][] = [
    ['Dupont Rénovation', '12 rue des Lilas', '69003', 'Lyon', 'Pose du carrelage', 150, null, null],
    ['SCI Les Tilleuls', '4 rue Béchevelin', '69007', 'Lyon', 'Entretien chaudière', 90, 18, 'Clés de la chaufferie à récupérer au bureau avant 8 h.'],
    ['Mme Garnier', '8 allée des Peupliers', '69100', 'Villeurbanne', 'Relevé cuisine', 45, 22, null],
    ['Martin & Fils', 'Zone des Platanes', '69200', 'Vénissieux', 'Plots et lambourdes', 75, 25, 'Prévenir M. Martin 30 minutes avant l\'arrivée.'],
    ...(long ? [
      ['Bernard Toiture', '21 chemin des Crêtes', '69110', 'Sainte-Foy-lès-Lyon', 'Reprise de zinguerie sur la noue côté jardin', 120, 28, null],
      ['Atelier Leroy', '3 quai Rambaud', '69002', 'Lyon', 'Diagnostic fuite', 60, 20, 'Accès par la cour, code 4512.'],
    ] as typeof stops : []),
  ]
  let minutes = 8 * 60
  const slots = stops.map(([title, addr, cp, city, label, duration, travel, notes], i) => {
    minutes += travel ?? 0
    const start = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
    minutes += duration
    const end = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
    return {
      id: `s-${i}`, chantier_id: `c-${i}`, event_type: 'intervention', title: label, planned_date: '2026-11-03', start_time: start, end_time: end,
      equipe_id: null, member_id: null, label, team_size: 1, notes, created_at: '2026-11-01T09:00:00Z',
      route_id: 'r-1', route_order: i + 1, duration_min: duration, travel_from_prev_min: travel, arrived_at: null,
      chantier_title: title, chantier_city: city, chantier_status: 'en_cours', chantier_color_idx: i,
      chantier_address_line1: addr, chantier_postal_code: cp,
    } as unknown as TourneeSlot
  })
  return {
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    slots,
    date: '2026-11-03',
    routeLabel: 'Équipe Karim',
    totalSiteMin: stops.reduce((s, x) => s + x[5], 0),
    totalTravelMin: stops.reduce((s, x) => s + (x[6] ?? 0), 0),
    departureAddress: '12 rue des Forges',
    departurePostalCode: '69007',
    departureCity: 'Lyon',
  }
}

export function rapportKpiData(long: boolean): RapportKpiPdfData {
  const base = {
    caHt: 18240, caTtc: 20064, encaisse: 13728, encaisseHt: 12480, encaisseTva: 1248, tvaDue: 1824, beneficeEstime: 6310,
    expensesCost: 3100, laborCost: 8830, tresorerieNette: 4200, hasCostData: true, costsLikelyIncomplete: false,
    projectedCostHt: 11300, projectedMarginHt: 6940, projectedMarginPct: 0.38, hasProjectedCostData: true, chantiersTermines: 3,
  }
  const people = ['Karim Benali', 'Samuel Mbeboura', 'Lucas Petit', 'Inès Moreau', 'Hugo Lambert']
  return {
    vue: long ? 'annee' : 'mois',
    year: 2026,
    month: 10,
    organization: { ...organization, logo_url: long ? SAMPLE_LOGO_PNG : null },
    monthlyReport: long ? null : ({ ...base, year: 2026, month: 10, chantiersEnCours: 4, nouvellesFactures: 14, facturesPayees: 9 } as unknown as MonthlyReport),
    annualReport: long ? ({ ...base, year: 2026, caHt: 182400, caTtc: 200640, encaisse: 151200, beneficeEstime: 52100, nouveauxClients: 23, heuresTotal: 3120, prevCaHt: 160000, prevCaTtc: 176000 } as unknown as AnnualReport) : null,
    hoursReport: { total: long ? 3120 : 312, byPerson: people.slice(0, long ? 5 : 2).map((personName, i) => ({ personName, hours: (long ? 700 : 160) - i * 40, userId: null, memberId: null })) },
    topClients: CLIENTS.slice(0, long ? 6 : 3).map((clientName, i) => ({ clientId: `c-${i}`, clientName, caHt: 9000 - i * 1100, marginEur: i === 2 ? -320 : 2800 - i * 300, chantiersCount: 2 })),
    topChantiers: ['Salle de bain Dupont', 'Terrasse bois Martin', 'Zinguerie Bernard', 'Cuisine Garnier'].slice(0, long ? 4 : 2).map((chantierTitle, i) => ({ chantierId: `ch-${i}`, chantierTitle, clientName: null, caHt: 7655 - i * 900, encaisseHt: 5000, encaisseTtc: 5500 - i * 600, costTotal: 4000, marginEur: 2400 - i * 500, marginPct: 0.3 })),
    objectives: long
      ? { year: 2026, revenue_ht_target: 220000, margin_eur_target: 60000, margin_pct_target: 30, chantiers_count_target: 40, new_clients_target: 30, hours_target: 3500, customs: [] }
      : { year: 2026, month: 10, revenue_ht_target: 20000, margin_eur_target: null, margin_pct_target: null, chantiers_count_target: 4, hours_target: null, customs: [] },
    editedAt: '2026-11-01T09:00:00Z',
  }
}
