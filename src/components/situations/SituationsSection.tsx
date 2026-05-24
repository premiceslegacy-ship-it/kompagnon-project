'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { TrendingUp, Eye, Plus, CheckCircle } from 'lucide-react'
import type { SituationsSummary } from '@/lib/data/queries/invoices'
import { generateSituationInvoice } from '@/lib/data/mutations/chantiers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

const STATUT_LABELS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-secondary/10 text-secondary' },
  sent:      { label: 'Envoyée',   cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  paid:      { label: 'Payée',     cls: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  partial:   { label: 'Partielle', cls: 'bg-orange-400/10 text-orange-500' },
  cancelled: { label: 'Annulée',   cls: 'bg-red-500/10 text-red-500' },
}

// ─── Modal ────────────────────────────────────────────────────────────────────

type ModalMode = 'situation' | 'solde'

function SituationCreatorModal({
  chantierId,
  summary,
  mode,
  returnTo,
  onClose,
}: {
  chantierId: string
  summary: SituationsSummary
  mode: ModalMode
  returnTo: string
  onClose: () => void
}) {
  const router = useRouter()
  const prevPct = summary.cumulativePct
  const isSolde = mode === 'solde'

  const [pct, setPct] = useState(() => {
    if (isSolde) return 100
    return Math.min(100, Math.round(prevPct + 25))
  })
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [retentionPct, setRetentionPct] = useState(0)
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
    <div className="modal-overlay">
      <div className="modal-panel space-y-5 sm:max-w-lg">
        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-accent" />
          {isSolde ? 'Solde de chantier' : `Situation n°${situationNum}`}
        </h2>

        {/* Barre de progression */}
        <div className="p-3 card space-y-2">
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>Devis total HT : {fmt(summary.quoteHt)}</span>
            <span>{isSolde ? 100 : effectivePct}% facturé</span>
          </div>
          <div className="h-2 bg-secondary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${Math.min(100, isSolde ? 100 : effectivePct)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-secondary">
            <span>Déjà facturé : {prevPct}% ({fmt(summary.billedHt + summary.acomptesHt)})</span>
            <span>Reste : {fmt(summary.remainingHt)}</span>
          </div>
        </div>

        {/* Pourcentage — masqué en mode solde */}
        {!isSolde && (
          <div>
            <label className="text-xs font-semibold text-secondary block mb-2">
              Pourcentage cumulé visé
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={prevPct + 1} max={100} step={1}
                value={pct}
                onChange={e => setPct(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-xl font-extrabold text-accent w-14 text-right">{pct}%</span>
            </div>
            <div className="flex gap-2 mt-2">
              {[Math.min(100, prevPct + 25), Math.min(100, prevPct + 33), Math.min(100, prevPct + 50), 100]
                .filter((v, i, arr) => arr.indexOf(v) === i && v > prevPct)
                .map(v => (
                  <button
                    key={v}
                    onClick={() => setPct(v)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-bold border transition-colors ${pct === v ? 'bg-accent text-black border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
                  >
                    {v}%
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Période */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-secondary block mb-1">Période du</label>
            <input
              type="date" value={periodFrom}
              onChange={e => setPeriodFrom(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-secondary block mb-1">au</label>
            <input
              type="date" value={periodTo}
              onChange={e => setPeriodTo(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
        </div>

        {/* Retenue de garantie */}
        <div>
          <label className="text-xs font-semibold text-secondary block mb-1">
            Retenue de garantie (%)
          </label>
          <div className="flex gap-2">
            {[0, 3, 5, 10].map(v => (
              <button
                key={v}
                onClick={() => setRetentionPct(v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${retentionPct === v ? 'bg-accent text-black border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
              >
                {v === 0 ? 'Aucune' : `${v}%`}
              </button>
            ))}
            <input
              type="number" min={0} max={100} step={0.5}
              value={retentionPct}
              onChange={e => setRetentionPct(parseFloat(e.target.value) || 0)}
              className="input w-20 text-sm"
              placeholder="Autre"
            />
          </div>
        </div>

        {/* Référence marché */}
        <div>
          <label className="text-xs font-semibold text-secondary block mb-1">
            Référence marché / N° d&apos;affaire (optionnel)
          </label>
          <input
            type="text" value={marketRef}
            onChange={e => setMarketRef(e.target.value)}
            placeholder="ex : MARCH-2026-001"
            className="input w-full text-sm"
          />
        </div>

        {/* Récap montants */}
        <div className="p-3 card space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-secondary">Montant HT cette {isSolde ? 'facture' : 'situation'}</span>
            <span className="font-bold text-primary">{fmt(thisHt)}</span>
          </div>
          {retentionPct > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Retenue de garantie {retentionPct}%</span>
              <span className="text-orange-500 font-semibold">-{fmt(retentionAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-[var(--elevation-border)] pt-1.5 mt-1">
            <span className="font-semibold text-primary">Net à payer HT</span>
            <span className="font-extrabold text-accent">{fmt(netAPayer)}</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Génération...' : isSolde ? 'Générer le solde' : 'Créer la situation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function SituationsSection({
  chantierId,
  summary,
  canCreateSituation,
  canCreateSolde,
  returnTo,
}: {
  chantierId: string
  summary: SituationsSummary
  canCreateSituation: boolean
  canCreateSolde: boolean
  returnTo: string
}) {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null)
  const router = useRouter()
  const showSoldeButton = canCreateSolde && !summary.fullyInvoiced && summary.cumulativePct >= 90

  return (
    <div className="space-y-4">
      {/* Barre de progression */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary">
            Devis total HT : <span className="font-bold text-primary">{fmt(summary.quoteHt)}</span>
          </span>
          <span className="font-bold text-primary">{summary.cumulativePct}% facturé</span>
        </div>
        <div className="h-2 bg-secondary/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: `${Math.min(100, summary.cumulativePct)}%` }}
          />
        </div>
        {summary.acomptesHt > 0 && (
          <p className="text-xs text-secondary">
            Dont acomptes versés : {fmt(summary.acomptesHt)}
          </p>
        )}
      </div>

      {/* Tableau des situations */}
      {summary.situations.length > 0 && (
        <div className="divide-y divide-[var(--elevation-border)] border border-[var(--elevation-border)] rounded-xl overflow-hidden">
          {summary.situations.map(s => {
            const st = STATUT_LABELS[s.status] ?? STATUT_LABELS['draft']
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-[var(--elevation-1)] hover:bg-accent/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-primary">
                      {s.invoice_type === 'solde' ? 'Solde' : `Situation n°${s.situation_number}`}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-secondary">
                    <span>{s.cumulative_pct}% cumulé</span>
                    {s.period_from && s.period_to && (
                      <span>Du {new Date(s.period_from).toLocaleDateString('fr-FR')} au {new Date(s.period_to).toLocaleDateString('fr-FR')}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-primary tabular-nums">{fmt(s.total_ht ?? 0)}</p>
                  {s.retention_pct ? (
                    <p className="text-xs text-orange-500">RG {s.retention_pct}%</p>
                  ) : null}
                </div>
                <button
                  onClick={() => router.push(`/finances/invoice-editor?id=${s.id}&returnTo=${encodeURIComponent(returnTo)}`)}
                  title="Voir la facture"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            )
          })}

          {/* Ligne reste à facturer */}
          {!summary.fullyInvoiced && (
            <div className="flex items-center gap-3 px-4 py-3 bg-accent/5">
              <div className="flex-1">
                <p className="text-sm text-secondary">Reste à facturer</p>
              </div>
              <p className="text-sm font-bold text-accent tabular-nums">{fmt(summary.remainingHt)}</p>
              <div className="w-8" />
            </div>
          )}
        </div>
      )}

      {/* Fully invoiced */}
      {summary.fullyInvoiced && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-semibold">
          <CheckCircle className="w-4 h-4" />
          Devis entièrement facturé
        </div>
      )}

      {/* Boutons d'action */}
      {!summary.fullyInvoiced && (
        <div className="flex gap-2 flex-wrap">
          {canCreateSituation && (
            <button
              onClick={() => setModalMode('situation')}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Créer situation n°{summary.situations.length + 1}
            </button>
          )}
          {showSoldeButton && (
            <button
              onClick={() => setModalMode('solde')}
              className="btn-primary text-sm flex items-center gap-1.5"
            >
              <CheckCircle className="w-4 h-4" />
              Créer le solde
            </button>
          )}
        </div>
      )}

      {/* Modal — portal pour éviter le bug fixed à l'intérieur d'un card (isolation: isolate) */}
      {modalMode && createPortal(
        <SituationCreatorModal
          chantierId={chantierId}
          summary={summary}
          mode={modalMode}
          returnTo={returnTo}
          onClose={() => setModalMode(null)}
        />,
        document.body
      )}
    </div>
  )
}
