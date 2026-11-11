'use client'
// @atelier-migrated
// Segment Argent : chiffres clés, jalons, facturation, dépenses, répartition des coûts, main-d'œuvre.

import { useRef, useState } from 'react'
import { ChevronDown, ScanLine } from 'lucide-react'
import SituationsSection from '@/components/situations/SituationsSection'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { StatusPill } from '@/components/ui/StatusPill'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type { InvoiceStub } from '@/lib/data/queries/invoices'
import { fmtHours } from '../chantiersModel'
import { InvoiceSheet, LinkInvoiceSheet, MarginSheet, RateSheet, ReceiptSheet } from './ArgentSheets'
import ExpenseSheet from './ExpenseSheet'
import JalonsSection from './JalonsSection'
import { EXPENSE_CATEGORIES, catLabel, fmtMoney, fmtPct, marginTone } from './rentabiliteModel'
import type { ChantierDetailState } from './useChantierDetail'
import { useRentabilite } from './useRentabilite'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

export default function ArgentSegment({ q, onOpenDetails }: { q: ChantierDetailState; onOpenDetails: () => void }) {
  const c = q.chantier
  const showProfit = q.canViewExpenses || q.canCreateExpenses
  return (
    <>
      {showProfit && <ProfitSection q={q} onOpenDetails={onOpenDetails} />}
      {!showProfit && q.canEditChantier && (
        <JalonsSection initialJalons={q.initialJalons} chantierId={c.id} budgetHt={c.budget_ht ?? 0} taches={q.taches} canSuggestAi={q.canSuggestAiMilestones} />
      )}
    </>
  )
}

function ProfitSection({ q, onOpenDetails }: { q: ChantierDetailState; onOpenDetails: () => void }) {
  const c = q.chantier
  const r = useRentabilite({
    chantierId: c.id,
    initialProfitability: q.initialProfitability,
    orgSector: q.orgSector,
    materials: q.materials,
    invoiceStubs: q.invoiceStubs,
    targetMarginPct: c.target_margin_pct ?? 30,
    permissions: {
      canCreateExpenses: q.canCreateExpenses,
      canEditExpenses: q.canEditExpenses,
      canDeleteExpenses: q.canDeleteExpenses,
      canEditRates: q.canEditRates,
      canEditChantier: q.canEditChantier,
    },
    deletedPointages: q.deletedPointages,
  })
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [invoice, setInvoice] = useState<InvoiceStub | null>(null)
  const [linking, setLinking] = useState(false)
  const [deleting, setDeleting] = useState<ChantierExpense | null>(null)
  const a = r.alerts
  const own = r.ownExpensesOnly
  const filterLabel = r.expenseFilter === 'all' ? 'Toutes les catégories' : catLabel(r.expenseFilter)
  const tone = marginTone(r.marginPct)

  return (
    <>
      {r.actionError && <p className={screen.error} role="alert">{r.actionError}</p>}

      {own && <p className={screen.note}>Vous voyez uniquement vos propres dépenses. Les indicateurs financiers du chantier ne sont pas accessibles avec votre rôle.</p>}

      {!own && (
        <>
          <div className={fiche.kpis}>
            <section className={fiche.kpi} aria-label="Marge facturée">
              <p className={fiche.kpiLabel}>Marge facturée</p>
              <p className={fiche.kpiValue}>{r.revenueHt > 0 ? fmtPct(r.marginPct) : '—'}</p>
              <p className={fiche.kpiSub}>{r.revenueHt > 0 ? <StatusPill status={tone}>{fmtMoney(r.marginEur)}</StatusPill> : 'Rien de facturé'}</p>
            </section>
            <section className={fiche.kpi} aria-label="Facturé">
              <p className={fiche.kpiLabel}>Facturé HT</p>
              <p className={fiche.kpiValue}>{r.revenueHt > 0 ? fmtMoney(r.revenueHt) : '—'}</p>
              <p className={fiche.kpiSub}>{r.collectedRevenueHt > 0 ? `Encaissé ${fmtMoney(r.collectedRevenueHt)}` : 'Aucun règlement'}</p>
            </section>
            <section className={fiche.kpi} aria-label="Coûts">
              <p className={fiche.kpiLabel}>Coûts HT</p>
              <p className={fiche.kpiValue}>{r.costTotal > 0 ? fmtMoney(r.costTotal) : '—'}</p>
              <p className={fiche.kpiSub}>{r.hoursLogged > 0 ? `${fmtHours(r.hoursLogged)} de main-d’œuvre` : 'Sans pointage'}</p>
              {a.costBudget > 0 && <div className={fiche.meter} data-over={a.budgetAlert} role="img" aria-label={`Coûts à ${Math.round(a.budgetUsedPct * 100)} % du budget maximum`}><span style={{ width: `${Math.min(100, a.budgetUsedPct * 100)}%` }} /></div>}
            </section>
            <section className={fiche.kpi} aria-label="Budget">
              {r.canEditChantier ? (
                <button type="button" className={fiche.kpiButton} onClick={() => { r.setMarginOpen(true) }}>
                  <p className={fiche.kpiLabel}>Budget devis HT</p>
                  <p className={fiche.kpiValue}>{fmtMoney(r.budgetHt)}</p>
                  <p className={fiche.kpiSub}>Marge cible {r.targetMarginPct}{NB}% · modifier</p>
                </button>
              ) : (
                <>
                  <p className={fiche.kpiLabel}>Budget devis HT</p>
                  <p className={fiche.kpiValue}>{fmtMoney(r.budgetHt)}</p>
                  <p className={fiche.kpiSub}>Marge cible {r.targetMarginPct}{NB}%</p>
                </>
              )}
            </section>
          </div>

          {a.budgetAlert && <p className={screen.alert} data-expired="true"><span>Les coûts dépassent 90 % du budget maximum ({fmtMoney(a.costBudget)} HT pour {r.targetMarginPct} % de marge). Risque de travailler sans marge.</span></p>}
          {a.subcontractAlert && <p className={screen.alert}><span>La sous-traitance représente {fmtPct(a.subcontractPct)} du budget du devis, au-delà des 40 % généralement conseillés.</span></p>}
          {a.marginAlert && <p className={screen.alert}><span>La marge facturée ({fmtPct(r.marginPct)}) est sous les 20 % recommandés pour rester rentable une fois le chantier soldé.</span></p>}

          {q.canEditChantier && <JalonsSection initialJalons={q.initialJalons} chantierId={c.id} budgetHt={c.budget_ht ?? 0} taches={q.taches} canSuggestAi={q.canSuggestAiMilestones} />}

          {q.situationsSummary && c.quote_id && (
            <SituationsSection
              chantierId={c.id}
              summary={q.situationsSummary}
              canCreateSituation={q.canCreateSituation}
              canCreateSolde={q.canCreateSolde}
              returnTo={`/chantiers/${c.id}`}
              defaultRetentionPct={c.default_retention_pct ?? 0}
            />
          )}

          <ListGroup title="Facturation">
            {r.linkedInvoices.map(inv => (
              <ListRow
                key={inv.id}
                title={[inv.number, inv.title].filter(Boolean).join(' · ') || '(sans titre)'}
                description={inv.status === 'paid' ? 'Encaissée' : inv.status === 'partial' ? 'Partiellement encaissée' : 'Non encaissée'}
                trailing={inv.total_ht != null ? <span className={styles.amount}>{fmtMoney(inv.total_ht)}</span> : undefined}
                onClick={() => setInvoice(inv)}
              />
            ))}
            {r.budgetHt > 0 && <ListRow title="Reste à facturer HT" trailing={<span className={styles.amount}>{fmtMoney(Math.max(0, r.budgetHt - r.revenueHt))}</span>} />}
            {r.canEditChantier && <ListRow title="Créer une facture" className={fiche.linkRow} href={`/finances/invoice-editor?chantier=${c.id}&returnTo=${encodeURIComponent(`/chantiers/${c.id}`)}`} />}
            {r.canEditChantier && r.availableToLink.length > 0 && <ListRow title="Rattacher une facture existante" className={fiche.linkRow} onClick={() => setLinking(true)} />}
            {q.billingPeriod !== 'none' && Number(q.billingAmount) > 0 && (
              <ListRow title="Facturation périodique" description={`${q.billingAmount}${NB}€ HT · prochaine le ${new Date(q.selectedBillingDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`} onClick={onOpenDetails} />
            )}
            {Number(q.retentionPct) > 0 && (
              <ListRow title={`Retenue de garantie · ${q.retentionPct}${NB}%`} description="Pré-remplie sur les nouvelles factures" onClick={onOpenDetails} />
            )}
          </ListGroup>
        </>
      )}

      {/* Dépenses */}
      <ListGroup
        title="Dépenses"
        description={r.expenses.length === 0 ? 'Aucune dépense. Ajoutez matériaux, sous-traitance ou autres frais.' : 'La main-d’œuvre vient des heures pointées et des taux horaires.'}
        action={
          <Menu
            title="Catégorie"
            items={[{ value: 'all', label: 'Toutes les catégories' }, ...EXPENSE_CATEGORIES].map(o => ({ label: o.label, checked: r.expenseFilter === o.value, onSelect: () => r.setExpenseFilter(o.value as ChantierExpense['category'] | 'all') }))}
            trigger={<button type="button" className={docs.chip} data-on={r.expenseFilter !== 'all' ? 'true' : 'false'}>{filterLabel}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
        }
      >
        {r.filteredExpenses.map(exp => {
          const description = [catLabel(exp.category), exp.supplier_name, new Date(exp.expense_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), !own ? exp.created_by_name : null].filter(Boolean).join(' · ')
          const trailing = <span className={styles.amount}>{fmtMoney(exp.amount_ht)}</span>
          if (r.canEditExpenses) return <ListRow key={exp.id} title={exp.label} description={description} trailing={trailing} onClick={() => r.setExpenseSheet({ expense: exp, override: null })} />
          if (exp.receipt_storage_path) return <ListRow key={exp.id} title={exp.label} description={description} trailing={trailing} onClick={() => r.handleViewReceipt(exp.receipt_storage_path!)} />
          return <ListRow key={exp.id} title={exp.label} description={description} trailing={trailing} />
        })}
        {r.canCreateExpenses && <ListRow title="Ajouter une dépense" className={fiche.linkRow} onClick={() => { r.setScanError(null); r.setExpenseSheet({ expense: null, override: null }) }} />}
        {r.canCreateExpenses && (
          <ListRow
            title={r.scanning ? 'Analyse du ticket…' : 'Scanner un ticket'}
            description="Photographiez un ticket pour pré-remplir la dépense."
            leading={<ScanLine size={18} aria-hidden="true" />}
            disabled={r.scanning}
            onClick={() => scanInputRef.current?.click()}
          />
        )}
      </ListGroup>
      {r.canCreateExpenses && (
        <input
          ref={scanInputRef}
          className={fiche.fileInput}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          tabIndex={-1}
          aria-label="Scanner un ticket"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) r.handleScan(file)
            e.target.value = ''
          }}
        />
      )}
      {r.scanError && <p className={screen.note} role="status">{r.scanError}</p>}

      {!own && (
        <>
          {r.costTotal > 0 && (
            <ListGroup title="Répartition des coûts">
              {([
                ['Matériel', r.costMaterial, null],
                ['Main-d’œuvre', r.costLabor, r.hoursLogged > 0 ? `${fmtHours(r.hoursLogged)} · ${r.laborByMember.length} membre${r.laborByMember.length > 1 ? 's' : ''}` : null],
                ['Sous-traitance', r.costSubcontract, null],
                ['Autres (location, transport…)', r.costOther, null],
              ] as const).filter(([, v]) => v > 0).map(([label, value, sub]) => (
                <ListRow key={label} title={label} description={[`${Math.round((value / r.costTotal) * 100)}${NB}%`, sub].filter(Boolean).join(' · ')} trailing={<span className={styles.amount}>{fmtMoney(value)}</span>} />
              ))}
            </ListGroup>
          )}

          {r.budgetCostTotal > 0 && (
            <ListGroup title="Coûts budgétés (devis)" description={r.revenueHt > 0 ? `Marge du devis : ${Math.round(((r.revenueHt - r.budgetCostTotal) / r.revenueHt) * 100)}${NB}%.` : undefined}>
              {r.budgetCostMaterial > 0 && <ListRow title="Matériel" description={r.costMaterial > 0 ? `${r.costMaterial <= r.budgetCostMaterial ? '−' : '+'}${fmtMoney(Math.abs(r.costMaterial - r.budgetCostMaterial))} sur le réel` : undefined} trailing={<span className={styles.amount}>{fmtMoney(r.budgetCostMaterial)}</span>} />}
              {r.budgetCostLabor > 0 && <ListRow title="Main-d’œuvre" description={r.costLabor > 0 ? `${r.costLabor <= r.budgetCostLabor ? '−' : '+'}${fmtMoney(Math.abs(r.costLabor - r.budgetCostLabor))} sur le réel` : undefined} trailing={<span className={styles.amount}>{fmtMoney(r.budgetCostLabor)}</span>} />}
              <ListRow title="Total budgété" trailing={<span className={styles.amount}>{fmtMoney(r.budgetCostTotal)}</span>} />
            </ListGroup>
          )}

          <ListGroup
            title="Main-d’œuvre"
            description={r.laborByMember.length === 0 ? 'Aucun pointage enregistré sur ce chantier.' : 'Le taux s’applique à tous les chantiers du membre.'}
          >
            {r.laborByMember.map(entry => {
              const text = `${fmtHours(entry.hours)} · ${entry.ratePerHour != null ? `${fmtMoney(entry.ratePerHour, 2)}/h` : 'taux non défini'}`
              const trailing = <span className={styles.amount}>{fmtMoney(entry.cost)}</span>
              const key = entry.user_id ?? entry.member_id ?? entry.membership_id
              return r.canEditRates && entry.membership_id
                ? <ListRow key={key} title={entry.full_name ?? 'Inconnu'} description={text} trailing={trailing} onClick={() => r.handleEditRate(entry)} />
                : <ListRow key={key} title={entry.full_name ?? 'Inconnu'} description={text} trailing={trailing} />
            })}
          </ListGroup>

          {r.periods.length > 0 && (
            <ListGroup title="Rentabilité par mois" description="Facturé, encaissé, coûts et marge par période.">
              {r.periods.slice(0, 18).map(p => (
                <ListRow
                  key={p.period}
                  title={p.label.charAt(0).toUpperCase() + p.label.slice(1)}
                  description={`Facturé ${fmtMoney(p.revenueHt)} · coûts ${fmtMoney(p.costTotal)}${p.hoursLogged > 0 ? ` · ${fmtHours(p.hoursLogged)}` : ''}`}
                  trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtMoney(p.marginEur)}</span>{p.revenueHt > 0 && <StatusPill status={marginTone(p.marginPct)}>{fmtPct(p.marginPct)}</StatusPill>}</span>}
                />
              ))}
            </ListGroup>
          )}
        </>
      )}

      {r.expenseSheet && (
        <ExpenseSheet
          chantierId={c.id}
          expense={r.expenseSheet.expense}
          override={r.expenseSheet.override}
          today={r.today}
          orgSector={r.orgSector ?? null}
          materials={r.materials}
          canDelete={r.canDeleteExpenses}
          onDelete={setDeleting}
          onViewReceipt={r.handleViewReceipt}
          onSaved={r.handleExpenseSaved}
          onClose={() => r.setExpenseSheet(null)}
        />
      )}
      {invoice && <InvoiceSheet q={r} invoice={invoice} onClose={() => setInvoice(null)} />}
      {linking && <LinkInvoiceSheet q={r} onClose={() => setLinking(false)} />}
      <RateSheet q={r} />
      <MarginSheet q={r} />
      <ReceiptSheet q={r} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer cette dépense ?"
        description="Elle sera retirée des coûts du chantier."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) r.handleDelete(deleting.id); setDeleting(null) }}
      />
    </>
  )
}
