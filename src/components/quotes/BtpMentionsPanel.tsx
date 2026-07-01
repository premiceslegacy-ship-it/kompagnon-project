'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, ShieldAlert } from 'lucide-react'
import { checkBtpMentions, countMissingByCategory, type BtpMentionCheck, type BtpMentionCategory } from '@/lib/btp-legal-mentions'

type Props = {
  quote: Parameters<typeof checkBtpMentions>[0]
  org: Parameters<typeof checkBtpMentions>[1]
}

const CATEGORY_LABELS: Record<BtpMentionCategory, string> = {
  identification: 'Identification entreprise',
  client: 'Identification client',
  description_travaux: 'Description des travaux',
  prix: 'Prix et montants',
  tva: 'TVA',
  delai: 'Délais',
  garanties: 'Garanties et assurances',
  paiement: 'Conditions de paiement',
  divers: 'Mentions diverses',
}

function SeverityIcon({ severity }: { severity: BtpMentionCheck['severity'] }) {
  if (severity === 'bloquant') return <ShieldAlert className="w-3.5 h-3.5 text-red-500 shrink-0" />
  if (severity === 'important') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
  return <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
}

export default function BtpMentionsPanel({ quote, org }: Props) {
  const [expanded, setExpanded] = useState<BtpMentionCategory | null>(null)
  const [showAll, setShowAll] = useState(false)

  const checks = useMemo(() => checkBtpMentions(quote, org), [quote, org])
  const summary = useMemo(() => countMissingByCategory(checks), [checks])

  const missing = checks.filter(c => c.missing)
  const ok = checks.filter(c => !c.missing)

  const byCategory = useMemo(() => {
    const cats = Object.keys(CATEGORY_LABELS) as BtpMentionCategory[]
    return cats.map(cat => ({
      cat,
      label: CATEGORY_LABELS[cat],
      missing: missing.filter(c => c.category === cat),
      ok: ok.filter(c => c.category === cat),
    })).filter(g => g.missing.length > 0 || (showAll && g.ok.length > 0))
  }, [missing, ok, showAll])

  if (summary.total === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-secondary uppercase tracking-wider">Mentions légales BTP</p>
        <div className="flex items-center gap-2 text-sm text-green-500">
          <CheckCircle2 className="w-4 h-4" />
          <span>Toutes les mentions contrôlées sont validées</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-secondary uppercase tracking-wider">Mentions légales BTP</p>
        <div className="flex items-center gap-2 text-xs">
          {summary.bloquant > 0 && (
            <span className="flex items-center gap-1 text-red-500 font-semibold">
              <ShieldAlert className="w-3 h-3" />{summary.bloquant} bloquant{summary.bloquant > 1 ? 's' : ''}
            </span>
          )}
          {summary.important > 0 && (
            <span className="flex items-center gap-1 text-amber-500 font-semibold">
              <AlertTriangle className="w-3 h-3" />{summary.important} important{summary.important > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {byCategory.map(({ cat, label, missing: catMissing, ok: catOk }) => {
          const visibleOk = showAll ? catOk : []
          if (catMissing.length === 0 && visibleOk.length === 0) return null
          const isOpen = expanded === cat
          const hasBloquant = catMissing.some(c => c.severity === 'bloquant')
          const hasMissing = catMissing.length > 0
          return (
            <div key={cat} className="border border-[var(--elevation-border)] rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : cat)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-[var(--elevation-1)] transition-colors"
              >
                <div className="flex items-center gap-2">
                  {hasMissing
                    ? hasBloquant
                      ? <ShieldAlert className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    : <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                  <span className="text-sm font-medium text-primary">{label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {catMissing.length > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${hasBloquant ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                      {catMissing.length} à compléter
                    </span>
                  )}
                  {visibleOk.length > 0 && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
                      {visibleOk.length} validée{visibleOk.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-secondary" /> : <ChevronDown className="w-3.5 h-3.5 text-secondary" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--elevation-border)] divide-y divide-[var(--elevation-border)]">
                  {catMissing.length > 0 && (
                    <div>
                      <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">À compléter</p>
                      {catMissing.map(c => (
                        <div key={c.id} className="px-3 py-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <SeverityIcon severity={c.severity} />
                            <span className="text-xs font-semibold text-primary">{c.label}</span>
                            {c.severity === 'bloquant' && (
                              <span className="text-xs text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full font-bold">Bloquant</span>
                            )}
                          </div>
                          <p className="text-xs text-secondary leading-relaxed pl-5">{c.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {visibleOk.length > 0 && (
                    <div>
                      <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">Validées</p>
                      {visibleOk.map(c => (
                        <div key={c.id} className="px-3 py-2.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                            <span className="text-xs font-semibold text-primary">{c.label}</span>
                          </div>
                          <p className="text-xs text-secondary leading-relaxed pl-5">{c.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowAll(v => !v)}
        className="text-xs text-secondary hover:text-accent transition-colors"
      >
        {showAll ? 'Masquer les mentions validées' : `Voir les ${ok.length} mentions validées`}
      </button>
    </div>
  )
}
