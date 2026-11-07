'use client'
// @atelier-migrated

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SituationsSummary } from '@/lib/data/queries/invoices'
import { generateSituationInvoice } from '@/lib/data/mutations/chantiers'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import styles from './Situations.module.css'

const fmt = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

const STATUT_LABELS: Record<string, { label: string; pill: StatusPillStatus }> = {
  draft: { label: 'Brouillon', pill: 'neutral' },
  sent: { label: 'Envoyée', pill: 'wait' },
  paid: { label: 'Payée', pill: 'success' },
  partial: { label: 'Partielle', pill: 'wait' },
  cancelled: { label: 'Annulée', pill: 'danger' },
}

type ModalMode = 'situation' | 'solde'

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <div className={styles.barFill} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

function SituationCreatorSheet({
  chantierId,
  summary,
  mode,
  returnTo,
  onClose,
  defaultRetentionPct = 0,
}: {
  chantierId: string
  summary: SituationsSummary
  mode: ModalMode
  returnTo: string
  onClose: () => void
  defaultRetentionPct?: number
}) {
  const router = useRouter()
  const prevPct = summary.cumulativePct
  const isSolde = mode === 'solde'

  const [pct, setPct] = useState(() => (isSolde ? 100 : Math.min(100, Math.round(prevPct + 25))))
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [retentionPct, setRetentionPct] = useState(defaultRetentionPct)
  const [marketRef, setMarketRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectivePct = isSolde ? 100 : pct
  const targetHt = summary.quoteHt * (effectivePct / 100)
  const thisHt = isSolde
    ? Math.max(0, summary.quoteHt - summary.billedHt - summary.acomptesHt)
    : Math.max(0, targetHt - summary.billedHt)
  const retentionAmount = Math.round(thisHt * (retentionPct / 100) * 100) / 100
  const netAPayer = thisHt - retentionAmount
  const situationNum = summary.situations.length + 1

  const presets = [Math.min(100, prevPct + 25), Math.min(100, prevPct + 33), Math.min(100, prevPct + 50), 100]
    .filter((v, i, arr) => arr.indexOf(v) === i && v > prevPct)
  const retentionOptions = [0, 3, 5, 10]

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    const { invoiceId, error: err } = await generateSituationInvoice({
      chantierId,
      progressRate: effectivePct,
      periodFrom: periodFrom || null,
      periodTo: periodTo || null,
      retentionPct,
      marketReference: marketRef || null,
      isSolde,
    })
    setLoading(false)
    if (err) return setError(err)
    onClose()
    if (invoiceId) {
      const params = new URLSearchParams({ id: invoiceId, returnTo })
      router.push(`/finances/invoice-editor?${params}`)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open && !loading) onClose() }}
      title={isSolde ? 'Solde du chantier' : `Situation n° ${situationNum}`}
      description={`Devis total ${fmt(summary.quoteHt)} HT · déjà facturé ${prevPct} %`}
      onConfirm={handleSubmit}
      confirmLabel={isSolde ? 'Générer le solde' : 'Créer la situation'}
      confirmLoading={loading}
    >
      <div className={styles.stack}>
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <span>{fmt(summary.billedHt + summary.acomptesHt)} déjà facturés</span>
            <strong>{effectivePct} % après cette {isSolde ? 'facture' : 'situation'}</strong>
          </div>
          <ProgressBar percent={effectivePct} />
          <div className={styles.progressFoot}>
            <span>Reste à facturer : {fmt(summary.remainingHt)}</span>
          </div>
        </div>

        {!isSolde && (
          <div className={styles.stack}>
            <div className={styles.sliderRow}>
              <input
                className={styles.slider}
                type="range"
                min={prevPct + 1}
                max={100}
                step={1}
                value={pct}
                aria-label="Pourcentage cumulé visé"
                onChange={e => setPct(parseInt(e.target.value, 10))}
              />
              <span className={styles.sliderValue}>{pct} %</span>
            </div>
            {presets.length > 1 && (
              <SegmentedControl
                fullWidth
                label="Avancement courant"
                value={presets.includes(pct) ? String(pct) : ''}
                options={presets.map(v => ({ value: String(v), label: `${v} %` }))}
                onChange={v => setPct(parseInt(v, 10))}
              />
            )}
          </div>
        )}

        <div className={styles.fields}>
          <Field type="date" label="Période du" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} />
          <Field type="date" label="au" value={periodTo} onChange={e => setPeriodTo(e.target.value)} />
          <Field type="text" label="Référence marché" hint="N° d’affaire, facultatif." placeholder="MARCH-2026-001" value={marketRef} onChange={e => setMarketRef(e.target.value)} />
        </div>

        <div className={styles.stack}>
          <SegmentedControl
            fullWidth
            label="Retenue de garantie"
            value={retentionOptions.includes(retentionPct) ? String(retentionPct) : ''}
            options={retentionOptions.map(v => ({ value: String(v), label: v === 0 ? 'Aucune' : `${v} %` }))}
            onChange={v => setRetentionPct(parseFloat(v))}
          />
          {!retentionOptions.includes(retentionPct) && (
            <p className={styles.note}>Retenue personnalisée : {retentionPct} %</p>
          )}
          <div className={styles.fields}>
            <Field type="number" label="Autre taux de retenue (%)" min={0} max={100} decimals={1} allowEmpty={false} value={retentionPct} onChange={v => setRetentionPct(v ?? 0)} />
          </div>
        </div>

        <ListGroup title="Récapitulatif">
          <ListRow title={`Montant HT de cette ${isSolde ? 'facture' : 'situation'}`} trailing={<span className={styles.value}>{fmt(thisHt)}</span>} />
          {retentionPct > 0 && (
            <ListRow title={`Retenue de garantie ${retentionPct} %`} trailing={<span className={styles.value}>−{fmt(retentionAmount)}</span>} />
          )}
          <ListRow title="Net à payer HT" trailing={<span className={styles.value}>{fmt(netAPayer)}</span>} />
        </ListGroup>

        {error && <p className={`${styles.note} ${styles.warn}`} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** Avancement facturé d'un devis : situations déjà émises, reste à facturer, création. */
export default function SituationsSection({
  chantierId,
  summary,
  canCreateSituation,
  canCreateSolde,
  returnTo,
  defaultRetentionPct = 0,
}: {
  chantierId: string
  summary: SituationsSummary
  canCreateSituation: boolean
  canCreateSolde: boolean
  returnTo: string
  defaultRetentionPct?: number
}) {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null)
  const showSoldeButton = canCreateSolde && !summary.fullyInvoiced && summary.cumulativePct >= 90

  return (
    <div className={styles.stack}>
      <div className={styles.progress}>
        <div className={styles.progressHead}>
          <span>Devis total HT : <strong>{fmt(summary.quoteHt)}</strong></span>
          <strong>{summary.cumulativePct} % facturé</strong>
        </div>
        <ProgressBar percent={summary.cumulativePct} />
        {summary.acomptesHt > 0 && <p className={styles.note}>Dont acomptes versés : {fmt(summary.acomptesHt)}</p>}
      </div>

      {summary.situations.length > 0 && (
        <ListGroup>
          {summary.situations.map(s => {
            const st = STATUT_LABELS[s.status] ?? STATUT_LABELS.draft
            const period = s.period_from && s.period_to
              ? ` · du ${new Date(s.period_from).toLocaleDateString('fr-FR')} au ${new Date(s.period_to).toLocaleDateString('fr-FR')}`
              : ''
            return (
              <ListRow
                key={s.id}
                title={s.invoice_type === 'solde' ? 'Solde' : `Situation n° ${s.situation_number}`}
                description={`${s.cumulative_pct} % cumulé${period}`}
                href={`/finances/invoice-editor?id=${s.id}&returnTo=${encodeURIComponent(returnTo)}`}
                trailing={
                  <span>
                    <span className={styles.value}>{fmt(s.total_ht ?? 0)}</span>
                    {s.retention_pct ? <span className={styles.valueMuted}>RG {s.retention_pct} %</span> : null}
                    <StatusPill status={st.pill}>{st.label}</StatusPill>
                  </span>
                }
              />
            )
          })}
          {!summary.fullyInvoiced && (
            <ListRow title="Reste à facturer" trailing={<span className={styles.value}>{fmt(summary.remainingHt)}</span>} />
          )}
        </ListGroup>
      )}

      {summary.fullyInvoiced && <p className={styles.done}>Devis entièrement facturé</p>}

      {!summary.fullyInvoiced && (
        <div className={styles.actions}>
          {canCreateSituation && (
            <Button variant="secondary" size="md" onClick={() => setModalMode('situation')}>
              Créer la situation n° {summary.situations.length + 1}
            </Button>
          )}
          {showSoldeButton && (
            <Button variant="secondary" size="md" onClick={() => setModalMode('solde')}>Créer le solde</Button>
          )}
        </div>
      )}

      {modalMode && (
        <SituationCreatorSheet
          chantierId={chantierId}
          summary={summary}
          mode={modalMode}
          returnTo={returnTo}
          onClose={() => setModalMode(null)}
          defaultRetentionPct={defaultRetentionPct}
        />
      )}
    </div>
  )
}
