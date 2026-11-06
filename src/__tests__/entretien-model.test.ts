import { describe, expect, it } from 'vitest'
import {
  applyCatalogItem, applyQuoteToContractForm, blankContract, budgetDraftAmount, budgetDraftForSource, buildIntervenants,
  buildMaintenancePeriodRows, computeDurationHours, contractExpectedBudget, contractPayload, contractToForm, expectedBudgetTotals,
  filterContracts, interventionDefaults, interventionPayload, intervenantName, invoiceBadge, marginStatus, todayStr, travelCost,
  withTimeField, withTravelField, blankIntervention,
} from '@/app/(app)/chantiers/entretien/entretienModel'
import type { MaintenanceContract, MaintenanceIntervention } from '@/lib/data/queries/maintenance'
import type { QuoteStub } from '@/lib/data/queries/quotes'

const contract = (over: Partial<MaintenanceContract> = {}) => ({
  id: 'c1', title: 'Entretien PAC', status: 'actif', frequence: 'annuelle', montant_ht: 600, vat_rate: 20, client_id: 'cl1', chantier_id: null,
  source_quote_id: null, facturation_auto: true, auto_send_delay_days: 2, equipements: [], period_cost_labor_ht: 100, period_cost_parts_ht: 50,
  period_cost_travel_ht: 0, period_cost_other_ht: 0, client: { id: 'cl1', company_name: 'Dupont SARL', first_name: null, last_name: null, email: null },
  ...over,
}) as MaintenanceContract

const iv = (over: Partial<MaintenanceIntervention> = {}) => ({
  id: 'i1', date_intervention: '2026-10-12', statut: 'réalisée', invoice_id: null, invoice: null, billable_amount_ht: 600, labor_cost_ht: 80,
  intervenant: null, intervenant_profile: null, intervenant_user_id: null, intervenant_member_id: null, intervenant_id: null, ...over,
}) as MaintenanceIntervention

describe('entretien : formulaires', () => {
  it('calcule la durée, y compris au-delà de minuit', () => {
    expect(computeDurationHours('08:00', '10:30')).toBe(2.5)
    expect(computeDurationHours('22:00', '02:00')).toBe(4)
    expect(computeDurationHours('', '10:00')).toBeNull()
  })

  it('met à jour la durée quand les horaires changent, sans l’effacer sinon', () => {
    const f = { ...blankIntervention(), duration_hours: '3' }
    expect(withTimeField(f, 'start_time', '09:00').duration_hours).toBe('3')
    expect(withTimeField({ ...f, end_time: '11:00' }, 'start_time', '09:00').duration_hours).toBe('2')
  })

  it('calcule le coût du déplacement et ne touche pas au coût tant qu’il manque une valeur', () => {
    expect(travelCost('80', '1,85', '7')).toBe(10.36)
    expect(travelCost('80', '', '7')).toBeNull()
    expect(travelCost('80', '1.85', '0')).toBeNull()
    let f = { ...blankIntervention(), cost_travel_ht: '12' }
    f = withTravelField(f, 'travel_km', '80')
    expect(f.cost_travel_ht).toBe('12')
    f = withTravelField(f, 'travel_fuel_price_per_liter', '1.85')
    f = withTravelField(f, 'travel_fuel_consumption_per_100km', '7')
    expect(f.cost_travel_ht).toBe('10.36')
  })

  it('transmet le contrat sans perte dans le formulaire et en revient', () => {
    const c = contract({ site_city: 'Lyon', date_fin: '2027-01-01', prochaine_intervention: '2026-12-01' })
    const form = contractToForm(c)
    expect(form.montant_ht).toBe('600')
    const payload = contractPayload(form, true)
    expect(payload.auto_send_delay_days).toBe(2)
    expect(payload.prochaine_intervention).toBe('2026-12-01')
    expect(payload.site_city).toBe('Lyon')
    // à la création, la prochaine intervention n’est pas envoyée
    expect(contractPayload(form, false).prochaine_intervention).toBeNull()
    // le délai d’envoi n’est gardé que si la facturation automatique est active
    expect(contractPayload({ ...form, facturation_auto: false }, true).auto_send_delay_days).toBeNull()
  })

  it('reprend les informations du devis source', () => {
    const quote = { id: 'q1', title: 'Pompe à chaleur', total_ht: 1200, internal_cost_total_ht: 700, client_city: 'Nantes', client_contact_name: null } as unknown as QuoteStub
    const f = applyQuoteToContractForm({ ...blankContract(), site_contact_name: 'Marie' }, quote, 'q1')
    expect(f.title).toBe('Entretien - Pompe à chaleur')
    expect(f.montant_ht).toBe('1200')
    expect(f.period_cost_other_ht).toBe('700')
    expect(f.site_city).toBe('Nantes')
    expect(f.site_contact_name).toBe('Marie')
  })

  it('range l’intervenant selon son groupe', () => {
    const options = buildIntervenants('u1', 'Moi', [{ user_id: 'u2', full_name: 'Paul', email: 'p@x.fr' }] as never, [{ id: 'g1', prenom: 'Léo', name: 'Martin' }] as never)
    expect(options.map(o => o.group)).toEqual(['moi', 'app', 'terrain'])
    const terrain = interventionPayload({ ...blankIntervention(), intervenant_id: 'g1' }, options)
    expect(terrain.intervenant_member_id).toBe('g1')
    expect(terrain.intervenant_user_id).toBeNull()
    const app = interventionPayload({ ...blankIntervention(), intervenant_id: 'u2' }, options)
    expect(app.intervenant_user_id).toBe('u2')
    expect(app.intervenant_member_id).toBeNull()
    expect(intervenantName(iv({ intervenant_user_id: 'u2' }), options)).toBe('Paul')
  })

  it('préremplit une nouvelle intervention depuis le contrat', () => {
    const f = interventionDefaults(contract({ period_cost_parts_ht: 50 }))
    expect(f.billable_amount_ht).toBe('600')
    expect(f.cost_parts_ht).toBe('50')
    expect(f.cost_travel_ht).toBe('')
  })

  it('filtre les contrats par statut et recherche', () => {
    const list = [contract(), contract({ id: 'c2', title: 'Chaudière', status: 'résilié' })]
    expect(filterContracts(list, 'all', '').map(c => c.id)).toEqual(['c1'])
    expect(filterContracts(list, 'résilié', '').map(c => c.id)).toEqual(['c2'])
    expect(filterContracts(list, 'all', 'dupont').map(c => c.id)).toEqual(['c1'])
    expect(filterContracts(list, 'all', 'zzz')).toEqual([])
  })
})

describe('entretien : marge et facturation', () => {
  it('additionne les coûts prévus et classe la marge', () => {
    const b = contractExpectedBudget(contract())
    expect(expectedBudgetTotals(b).total).toBe(150)
    expect(expectedBudgetTotals({ labor: '1,5', parts: '', travel: 'abc', other: '2' }).total).toBe(3.5)
    expect(marginStatus(0.25)).toBe('success')
    expect(marginStatus(0.1)).toBe('wait')
    expect(marginStatus(-0.2)).toBe('danger')
  })

  it('remplit une ligne de coût depuis le catalogue', () => {
    const catalog = {
      materials: [{ id: 'm1', name: 'Filtre', item_kind: 'article', unit: 'u', purchase_price: 12, sale_price: 20 }],
      laborRates: [{ id: 'l1', designation: 'Technicien', unit: 'h', cost_rate: 35, rate: 60 }],
      prestationTypes: [{ id: 'p1', name: 'Forfait déplacement', unit: 'forfait', base_cost_ht: 25 }],
    } as never
    const m = applyCatalogItem(budgetDraftForSource('material'), 'material', 'm1', catalog)
    expect([m.category, m.label, m.unitCost]).toEqual(['parts', 'Filtre', '12'])
    const l = applyCatalogItem(budgetDraftForSource('labor'), 'labor', 'l1', catalog)
    expect([l.category, l.unitCost]).toEqual(['labor', '35'])
    const p = applyCatalogItem(budgetDraftForSource('prestation'), 'prestation', 'p1', catalog)
    expect([p.category, p.unit]).toEqual(['other', 'forfait'])
    expect(applyCatalogItem(m, 'material', '', catalog).label).toBe('')
    expect(budgetDraftAmount({ ...m, quantity: '3', unitCost: '12,5' })).toBe(37.5)
  })

  it('range facturé, payé, brouillon et à facturer par mois', () => {
    const c = contract()
    const rows = buildMaintenancePeriodRows(
      c,
      [
        iv({ id: 'a', date_intervention: '2026-10-12', invoice_id: 'f1', invoice: { id: 'f1', number: 'F-1', status: 'paid', total_ht: 600 } }),
        iv({ id: 'b', date_intervention: '2026-10-20', invoice_id: 'f2', invoice: { id: 'f2', number: null, status: 'draft', total_ht: 300 } }),
        iv({ id: 'c', date_intervention: '2026-10-25' }),
        iv({ id: 'd', date_intervention: '2026-09-02', statut: 'planifiée' }),
      ],
      [{ id: 'e1', expense_date: '2026-10-05', amount_ht: 40, category: 'transport', label: 'Péage', maintenance_intervention_id: null }],
      [],
      new Date(2026, 10, 6),
    )
    expect(rows.map(r => r.period)).toEqual(['2026-11', '2026-10', '2026-09'])
    const oct = rows[1]
    expect(oct.interventions).toBe(3)
    expect(oct.billedRevenueHt).toBe(600)
    expect(oct.paidRevenueHt).toBe(600)
    expect(oct.draftRevenueHt).toBe(300)
    expect(oct.pendingRevenueHt).toBe(600)
    expect(oct.travelCostHt).toBe(40)
    expect(oct.invoiceId).toBe('f1')
    // le coût réel (80 × 3 + 40) remplace le coût prévu
    expect(oct.actualCostHt).toBe(280)
    expect(oct.marginEur).toBe(320)
    // un mois sans coût réel retombe sur le coût prévu
    expect(rows[0].actualCostHt).toBe(150)
  })

  it('compte les factures récurrentes émises et garde le mois courant en local', () => {
    const rows = buildMaintenancePeriodRows(
      contract(), [], [],
      [{ id: 'r1', invoice_id: 'f9', scheduled_date: '2026-11-01', status: 'done', amount_ht: 600, invoice_status: 'sent', invoice_total_ht: null }],
      new Date(2026, 10, 30, 23, 30),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].period).toBe('2026-11')
    expect(rows[0].billedRevenueHt).toBe(600)
    expect(rows[0].paidRevenueHt).toBe(0)
  })

  it('formate la date locale sans décalage et l’état de facture', () => {
    expect(todayStr(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
    expect(invoiceBadge({ id: 'f', number: 'F-2', status: 'paid' })).toEqual({ label: 'Payée', pill: 'success' })
    expect(invoiceBadge({ id: 'f', number: null, status: 'draft' }).label).toBe('Facture brouillon')
  })
})
