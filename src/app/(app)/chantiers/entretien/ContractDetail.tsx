'use client'
// @atelier-migrated
// Contrat ouvert : tarif, interventions, marge prévue, suivi par période, dépenses, site, installations.

import { useState } from 'react'
import { ChevronLeft, MoreHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { StatusPill } from '@/components/ui/StatusPill'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type { MaintenanceContract, MaintenanceIntervention } from '@/lib/data/queries/maintenance'
import InterventionPanel from './InterventionPanel'
import MaintenanceDepensesSection from './MaintenanceDepensesSection'
import { BudgetSheet, PeriodSheet } from './EntretienSheets'
import {
  CONTRACT_STATUS, FREQUENCE_LABELS, INTERVENTION_STATUS, buildMaintenancePeriodRows, clientDisplayName, expectedBudgetTotals, expectedCostOf,
  fmtDate, fmtHours, fmtMoney, fmtPct, invoiceBadge, intervenantName, mapsUrl, marginStatus, todayStr, type PeriodRow,
} from './entretienModel'
import { useContractDetail } from './useContractDetail'
import type { EntretienProps, EntretienState } from './useEntretien'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'
import local from './Entretien.module.css'

const NB = ' '

export default function ContractDetail({ q, contract: c, catalog, orgSector }: {
  q: EntretienState
  contract: MaintenanceContract
  catalog: Pick<EntretienProps, 'materials' | 'laborRates' | 'prestationTypes' | 'ghostMembers' | 'teamMembers'>
  orgSector: string | null
}) {
  const d = useContractDetail({ contract: c, materials: catalog.materials, laborRates: catalog.laborRates, prestationTypes: catalog.prestationTypes, onContractUpdated: q.handleContractUpdated })
  const [viewId, setViewId] = useState<string | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [period, setPeriod] = useState<PeriodRow | null>(null)

  const status = CONTRACT_STATUS[c.status]
  const client = clientDisplayName(c.client)
  const montantTTC = c.montant_ht !== null ? c.montant_ht * (1 + c.vat_rate / 100) : null
  const expectedCost = expectedCostOf(c)
  const budget = expectedBudgetTotals({ labor: String(c.period_cost_labor_ht || ''), parts: String(c.period_cost_parts_ht || ''), travel: String(c.period_cost_travel_ht || ''), other: String(c.period_cost_other_ht || '') })
  const price = c.montant_ht ?? 0
  const margin = price - budget.total
  const marginPct = price > 0 ? margin / price : 0

  const sorted = [...q.interventions].sort((a, b) => new Date(b.date_intervention).getTime() - new Date(a.date_intervention).getTime())
  const planned = sorted.filter(iv => iv.statut === 'planifiée')
  const history = sorted.filter(iv => iv.statut !== 'planifiée')
  const periodRows = buildMaintenancePeriodRows(c, q.interventions, q.expenses, q.recurringInstances)
  const showPeriods = (price > 0 || expectedCost > 0 || q.interventions.some(iv => iv.statut === 'réalisée') || q.expenses.length > 0 || q.recurringInstances.length > 0) && periodRows.length > 0
  const siteAddress = [c.site_address_line1, c.site_postal_code, c.site_city].filter(Boolean).join(', ')
  const siteMaps = mapsUrl([c.site_address_line1, c.site_postal_code, c.site_city])
  const hasSite = !!(c.site_name || siteAddress || c.site_contact_name || c.site_contact_phone || c.site_contact_email)
  const viewed: MaintenanceIntervention | null = viewId ? q.interventions.find(iv => iv.id === viewId) ?? null : null
  const upcoming = c.prochaine_intervention && c.prochaine_intervention >= todayStr() ? c.prochaine_intervention : null

  const ivRow = (iv: MaintenanceIntervention) => {
    const st = INTERVENTION_STATUS[iv.statut]
    const who = intervenantName(iv, q.intervenants)
    const costs = (iv.cost_parts_ht ?? 0) + (iv.cost_travel_ht ?? 0) + (iv.cost_other_ht ?? 0)
    const badge = iv.invoice ? invoiceBadge(iv.invoice) : null
    return (
      <ListRow
        key={iv.id}
        title={fmtDate(iv.date_intervention)}
        description={[who, iv.duration_hours != null ? fmtHours(iv.duration_hours) : null, costs > 0 ? `${fmtMoney(costs)} de coûts` : null].filter(Boolean).join(' · ') || undefined}
        trailing={<span className={styles.trailStack}><StatusPill status={st.pill}>{st.label}</StatusPill>{badge && <StatusPill status={badge.pill}>{badge.label}</StatusPill>}</span>}
        onClick={() => setViewId(iv.id)}
      />
    )
  }

  return (
    <div className={local.detail}>
      <div>
        <button type="button" className={`${styles.back} ${local.onlyNarrow}`} onClick={q.closeDetail}>
          <ChevronLeft size={20} aria-hidden="true" />
          Contrats
        </button>
      </div>

      <header className={local.detailHead}>
        <div style={{ minWidth: 0 }}>
          <p className={local.meta}>
            <StatusPill status={status.pill}>{status.label}</StatusPill>
            <span>{FREQUENCE_LABELS[c.frequence]}</span>
            {client && <span>{client}</span>}
          </p>
          <h2 className={local.detailTitle}>{c.title}</h2>
          {montantTTC !== null && <p className={screen.note} style={{ margin: '4px 0 0' }}>{fmtMoney(montantTTC)} TTC par période</p>}
        </div>
        <div className={styles.headerEnd}>
          <Menu
            title="Contrat"
            items={[
              { label: 'Modifier le contrat', onSelect: () => q.openEditContract(c) },
              { label: 'Résilier le contrat', destructive: true, onSelect: () => q.setConfirmDelete({ type: 'contract', id: c.id }) },
            ]}
            trigger={<button type="button" className={screen.round} aria-label="Plus d’options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
          />
          <button type="button" className={`${screen.round} ${local.onlyWide}`} aria-label="Fermer le contrat" onClick={q.closeDetail}><X size={20} aria-hidden="true" /></button>
        </div>
      </header>

      <div className={local.cta}>
        <Button size="lg" onClick={q.openCreateIntervention}>Saisir une intervention</Button>
      </div>
      {q.actionError && <p className={screen.error} role="alert">{q.actionError}</p>}

      {q.loadingDetail ? (
        <p className={local.loading} role="status">Chargement du contrat…</p>
      ) : (
        <>
          <ListGroup title="Contrat">
            {c.montant_ht !== null && <ListRow title="Prix par période HT" description={`${c.vat_rate}${NB}% de TVA`} trailing={<span className={styles.amount}>{fmtMoney(c.montant_ht)}</span>} />}
            {upcoming && <ListRow title="Prochaine intervention" trailing={<span className={styles.amount}>{fmtDate(upcoming)}</span>} />}
            {c.date_debut && <ListRow title="Début" trailing={<span className={styles.amount}>{fmtDate(c.date_debut)}</span>} />}
            {c.date_fin && <ListRow title="Fin" trailing={<span className={styles.amount}>{fmtDate(c.date_fin)}</span>} />}
            <ListRow
              title="Marge prévue par période"
              description={`${fmtMoney(price)} de prix − ${fmtMoney(budget.total)} de coûts prévus`}
              trailing={<span className={styles.trailStack}><span className={`${styles.amount} ${margin >= 0 ? local.good : local.bad}`}>{fmtMoney(margin)}</span>{price > 0 && <StatusPill status={marginStatus(marginPct)}>{fmtPct(marginPct)}</StatusPill>}</span>}
              onClick={() => setBudgetOpen(true)}
            />
            {c.facturation_auto && (
              c.recurring_invoice_id
                ? <ListRow title="Facturation automatique" description={c.auto_send_delay_days != null ? `Envoi auto après ${c.auto_send_delay_days}${NB}j sans validation. Voir le modèle.` : 'Validation manuelle. Voir le modèle.'} href={`/finances/recurring?highlight=${c.recurring_invoice_id}`} />
                : <ListRow title="Facturation automatique" description={c.auto_send_delay_days != null ? `Envoi auto après ${c.auto_send_delay_days}${NB}j sans validation` : 'Validation manuelle'} />
            )}
          </ListGroup>

          {sorted.length === 0 ? (
            <ListGroup title="Interventions"><ListRow title="Aucune intervention enregistrée" description="Saisissez la première pour suivre le temps, les coûts et la facturation." /></ListGroup>
          ) : (
            <>
              {planned.length > 0 && <ListGroup title="À venir">{planned.map(ivRow)}</ListGroup>}
              {history.length > 0 && <ListGroup title="Historique">{history.map(ivRow)}</ListGroup>}
            </>
          )}

          {showPeriods && (
            <ListGroup title="Suivi par période" description="Le réel ne compte que les factures envoyées, partielles ou payées.">
              {periodRows.map(row => {
                const hasBilled = row.billedRevenueHt > 0
                const bits = [
                  hasBilled ? `Facturé ${fmtMoney(row.billedRevenueHt)}${row.paidRevenueHt >= row.billedRevenueHt ? ' · encaissé' : row.paidRevenueHt > 0 ? ` · encaissé ${fmtMoney(row.paidRevenueHt)}` : ''}` : null,
                  row.draftRevenueHt > 0 ? `brouillon ${fmtMoney(row.draftRevenueHt)}` : null,
                  row.pendingRevenueHt > 0 && !hasBilled && row.draftRevenueHt === 0 ? `à facturer ${fmtMoney(row.pendingRevenueHt)}` : null,
                ].filter(Boolean)
                return (
                  <ListRow
                    key={row.period}
                    title={row.label.charAt(0).toUpperCase() + row.label.slice(1)}
                    description={bits.join(' · ') || (row.expectedRevenueHt > 0 ? `Base prévue ${fmtMoney(row.expectedRevenueHt)}` : undefined)}
                    trailing={hasBilled
                      ? <span className={styles.trailStack}><span className={`${styles.amount} ${row.marginEur >= 0 ? local.good : local.bad}`}>{row.marginEur >= 0 ? '+' : ''}{fmtMoney(row.marginEur)}</span><StatusPill status={marginStatus(row.marginPct)}>{fmtPct(row.marginPct)}</StatusPill></span>
                      : undefined}
                    onClick={() => setPeriod(row)}
                  />
                )
              })}
            </ListGroup>
          )}

          {c.chantier_id ? (
            <MaintenanceDepensesSection
              chantierId={c.chantier_id}
              initialExpenses={q.expenses.map(e => ({
                id: e.id,
                chantier_id: c.chantier_id!,
                category: (e.category ?? 'autre') as ChantierExpense['category'],
                label: e.label,
                amount_ht: e.amount_ht,
                vat_rate: e.vat_rate ?? 20,
                expense_date: e.expense_date,
                supplier_name: e.supplier_name ?? null,
                received_invoice_id: null,
                receipt_storage_path: e.receipt_storage_path ?? null,
                notes: e.notes ?? null,
                created_by: null,
                created_at: '',
              }))}
              orgSector={orgSector}
              materials={catalog.materials}
            />
          ) : (
            <ListGroup title="Dépenses" description="Les dépenses sont disponibles dès que ce contrat est lié à un chantier."><ListRow title="Aucune dépense" /></ListGroup>
          )}

          {c.description && <p className={local.text}>{c.description}</p>}

          {hasSite && (
            <ListGroup title="Site d’intervention">
              {c.site_name && <ListRow title={c.site_name} />}
              {siteAddress && (siteMaps ? <ListRow title={siteAddress} description="Ouvrir dans Plans" href={siteMaps} target="_blank" rel="noreferrer" className={fiche.linkRow} /> : <ListRow title={siteAddress} />)}
              {c.site_contact_name && <ListRow title={c.site_contact_name} description="Contact sur site" />}
              {c.site_contact_phone && <ListRow title={c.site_contact_phone} description="Appeler" href={`tel:${c.site_contact_phone}`} className={fiche.linkRow} />}
              {c.site_contact_email && <ListRow title={c.site_contact_email} description="Écrire" href={`mailto:${c.site_contact_email}`} className={fiche.linkRow} />}
            </ListGroup>
          )}

          {c.equipements && c.equipements.length > 0 && (
            <ListGroup title="Installations à maintenir">
              {c.equipements.map((eq, i) => <ListRow key={i} title={eq.nom || 'Installation'} description={[eq.ref, eq.localisation].filter(Boolean).join(' · ') || undefined} />)}
            </ListGroup>
          )}
        </>
      )}

      {viewed && (
        <InterventionPanel
          key={viewed.id}
          iv={viewed}
          contract={c}
          intervenants={q.intervenants}
          busy={q.saving}
          error={q.actionError}
          onClose={() => setViewId(null)}
          onEdit={() => { setViewId(null); q.openEditIntervention(viewed) }}
          onBill={() => q.invoiceIntervention(viewed)}
          onMarkDone={() => q.markInterventionDone(viewed)}
          onDelete={() => { setViewId(null); q.setConfirmDelete({ type: 'intervention', id: viewed.id }) }}
        />
      )}
      <BudgetSheet c={c} d={d} open={budgetOpen} onClose={() => setBudgetOpen(false)} materials={catalog.materials} laborRates={catalog.laborRates} prestationTypes={catalog.prestationTypes} />
      <PeriodSheet row={period} d={d} onClose={() => setPeriod(null)} />
    </div>
  )
}
