'use client'

import { useState, useEffect, useTransition } from 'react'
import { X, Download, AlertTriangle, Info, RefreshCw } from 'lucide-react'

type ExportFormat = 'fec' | 'csv'
type ExportPeriod = 'current_month' | 'current_quarter' | 'fiscal_year' | 'custom'
type ExportPreset = 'fiscal_year' | 'period'

type PreviewData = {
  invoiceCount: number
  acompteCount: number
  avoirCount: number
  paymentCount: number
  receivedInvoiceCount: number
  autoLiqCount: number
  vatBreakdowns: {
    base20: number
    base10: number
    base55: number
    tva20: number
    tva10: number
    tva55: number
    total: number
  }
  estimatedLines: number
  numberingHasGaps: boolean
  numberingGaps: string[]
}

type Props = {
  isVatSubject: boolean
  isMicro: boolean
  tvaLabel: string
  nafCode: string | null
  siren: string | null
  onClose: () => void
}

function firstDayOfMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function lastDayOfMonth(): string {
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return last.toISOString().substring(0, 10)
}

function firstDayOfQuarter(): string {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const month = q * 3
  return `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}-01`
}

function lastDayOfQuarter(): string {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const endMonth = (q + 1) * 3
  const last = new Date(now.getFullYear(), endMonth, 0)
  return last.toISOString().substring(0, 10)
}

function firstDayOfYear(): string {
  return `${new Date().getFullYear()}-01-01`
}

function lastDayOfYear(): string {
  return `${new Date().getFullYear()}-12-31`
}

function fmtEur(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('json')) {
      const body = await res.json()
      return body.error ?? fallback
    }

    const text = await res.text()
    return text.trim() || fallback
  } catch {
    return fallback
  }
}

export default function ExportComptableModal({ isVatSubject, isMicro, tvaLabel, nafCode, siren, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>(isMicro ? 'csv' : 'fec')
  const [period, setPeriod] = useState<ExportPeriod>('fiscal_year')
  const [from, setFrom] = useState(firstDayOfYear())
  const [to, setTo] = useState(lastDayOfYear())
  const [includeInvoices, setIncludeInvoices] = useState(true)
  const [includeAvoirs, setIncludeAvoirs] = useState(true)
  const [includePayments, setIncludePayments] = useState(true)
  const [includeReceived, setIncludeReceived] = useState(true)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isLoadingPreview, startPreviewTransition] = useTransition()
  const [isDownloading, setIsDownloading] = useState(false)

  function updateDates(p: ExportPeriod) {
    setPeriod(p)
    if (p === 'current_month') { setFrom(firstDayOfMonth()); setTo(lastDayOfMonth()) }
    if (p === 'current_quarter') { setFrom(firstDayOfQuarter()); setTo(lastDayOfQuarter()) }
    if (p === 'fiscal_year') { setFrom(firstDayOfYear()); setTo(lastDayOfYear()) }
  }

  useEffect(() => {
    if (!from || !to) return
    startPreviewTransition(async () => {
      setPreviewError(null)
      try {
        const res = await fetch('/api/exports/fec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to,
            include_invoices: includeInvoices,
            include_avoirs: includeAvoirs,
            include_payments: includePayments,
            include_received: includeReceived,
          }),
        })
        if (!res.ok) {
          setPreviewError(await readErrorMessage(res, "Impossible de charger l’aperçu."))
          return
        }
        setPreview(await res.json())
      } catch {
        setPreviewError("Erreur lors du chargement de l’aperçu.")
      }
    })
  }, [from, to, includeInvoices, includeAvoirs, includePayments, includeReceived])

  async function handleDownload() {
    setDownloadError(null)
    setIsDownloading(true)
    try {
      const preset: ExportPreset = period === 'fiscal_year' ? 'fiscal_year' : 'period'
      const params = new URLSearchParams({
        from, to, format, preset,
        include_invoices: includeInvoices ? 'true' : 'false',
        include_avoirs: includeAvoirs ? 'true' : 'false',
        include_payments: includePayments ? 'true' : 'false',
        include_received: includeReceived ? 'true' : 'false',
      })
      const res = await fetch(`/api/exports/fec?${params.toString()}`)
      if (!res.ok) {
        setDownloadError(await readErrorMessage(res, "Erreur lors de la génération du fichier."))
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') ?? ''
      const filenameMatch = disposition.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? `export-comptable.${format === 'fec' ? 'txt' : 'csv'}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError("Erreur inattendue lors du téléchargement.")
    } finally {
      setIsDownloading(false)
    }
  }

  const preset: ExportPreset = period === 'fiscal_year' ? 'fiscal_year' : 'period'
  const isBlockingGap = preview?.numberingHasGaps && format === 'fec' && preset === 'fiscal_year'
  const hasSelectedContent = includeInvoices || includeAvoirs || includePayments || includeReceived
  const hasDownloadableContent = format === 'fec'
    ? hasSelectedContent
    : (includeInvoices || includeAvoirs || includePayments)

  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Export comptable</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">

          {/* Régime détecté */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">Régime détecté</p>
            <p className="text-sm text-zinc-900 dark:text-white font-medium">{tvaLabel}{nafCode ? ` — NAF ${nafCode}` : ''}</p>
          </div>

          {isMicro && (
            <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-4 py-3 flex gap-3">
              <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Micro-entrepreneur — export CSV uniquement (le FEC ne s’applique pas aux régimes micro, art. 50-0 CGI).
              </p>
            </div>
          )}

          {!isVatSubject && !isMicro && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 flex gap-3">
              <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Organisation en franchise art. 293 B CGI — export sans TVA.
              </p>
            </div>
          )}

          {/* Format */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Format</p>
            <div className="flex gap-3">
              {!isMicro && (
                <button
                  onClick={() => setFormat('fec')}
                  className={`flex-1 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                    format === 'fec'
                      ? 'bg-accent/10 border-accent/40 text-zinc-900 dark:text-white'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  FEC (Fichier des Écritures Comptables)
                </button>
              )}
              <button
                onClick={() => setFormat('csv')}
                className={`flex-1 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  format === 'csv'
                    ? 'bg-accent/10 border-accent/40 text-zinc-900 dark:text-white'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                CSV simplifié (Excel)
              </button>
            </div>
          </div>

          {/* Période */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Période</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['current_month', 'current_quarter', 'fiscal_year', 'custom'] as ExportPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => updateDates(p)}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    period === p
                      ? 'bg-accent/10 border-accent/40 text-zinc-900 dark:text-white'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  {p === 'current_month' ? 'Mois courant' :
                   p === 'current_quarter' ? 'Trimestre courant' :
                   p === 'fiscal_year' ? 'Exercice complet' : 'Personnalisée'}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Du</label>
                <input
                  type="date"
                  value={from}
                  onChange={e => { setFrom(e.target.value); setPeriod('custom') }}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">Au</label>
                <input
                  type="date"
                  value={to}
                  onChange={e => { setTo(e.target.value); setPeriod('custom') }}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Contenu */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Contenu</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'invoices', label: 'Factures émises', value: includeInvoices, set: setIncludeInvoices },
                { key: 'avoirs', label: 'Avoirs', value: includeAvoirs, set: setIncludeAvoirs },
                { key: 'payments', label: 'Paiements enregistrés', value: includePayments, set: setIncludePayments },
                { key: 'received', label: 'Factures fournisseurs reçues', value: includeReceived, set: setIncludeReceived },
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => item.set(!item.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs text-left transition-all ${
                    item.value
                      ? 'bg-accent/10 border-accent/40 text-zinc-900 dark:text-white'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                    item.value ? 'bg-accent' : 'bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600'
                  }`}>
                    {item.value && <div className="w-2 h-2 bg-white rounded-sm" />}
                  </div>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aperçu */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">Aperçu</p>
              {isLoadingPreview && <RefreshCw className="w-3.5 h-3.5 text-zinc-400 animate-spin" />}
            </div>

            {previewError && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{previewError}</p>
            )}

            {preview && !isLoadingPreview && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-400">Factures</p>
                    <p className="font-semibold text-zinc-900 dark:text-white">{preview.invoiceCount}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-400">Avoirs</p>
                    <p className="font-semibold text-zinc-900 dark:text-white">{preview.avoirCount}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-400">Paiements</p>
                    <p className="font-semibold text-zinc-900 dark:text-white">{preview.paymentCount}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-400">Factures reçues</p>
                    <p className="font-semibold text-zinc-900 dark:text-white">{preview.receivedInvoiceCount}</p>
                  </div>
                </div>
                {isVatSubject && (
                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    {preview.vatBreakdowns.base20 > 0 && (
                      <p className="text-zinc-500 dark:text-zinc-400">Base HT 20 % : <span className="text-zinc-900 dark:text-white font-medium">{fmtEur(preview.vatBreakdowns.base20)}</span></p>
                    )}
                    {preview.vatBreakdowns.base10 > 0 && (
                      <p className="text-zinc-500 dark:text-zinc-400">Base HT 10 % : <span className="text-zinc-900 dark:text-white font-medium">{fmtEur(preview.vatBreakdowns.base10)}</span></p>
                    )}
                    {preview.vatBreakdowns.base55 > 0 && (
                      <p className="text-zinc-500 dark:text-zinc-400">Base HT 5,5 % : <span className="text-zinc-900 dark:text-white font-medium">{fmtEur(preview.vatBreakdowns.base55)}</span></p>
                    )}
                    <p className="text-zinc-500 dark:text-zinc-400">TVA collectée : <span className="text-zinc-900 dark:text-white font-medium">{fmtEur(preview.vatBreakdowns.total)}</span></p>
                  </div>
                )}
                {format === 'fec' && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    Écritures estimées : ~{preview.estimatedLines}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Warnings */}
          {!!preview?.autoLiqCount && preview.autoLiqCount > 0 && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {preview.autoLiqCount} facture{preview.autoLiqCount > 1 ? 's' : ''} avec auto-liquidation TVA détectée{preview.autoLiqCount > 1 ? 's' : ''} (sous-traitance BTP). Vérifiez les écritures miroir avec votre comptable.
              </p>
            </div>
          )}

          {isBlockingGap && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-300">
                <p className="font-semibold">Trou(s) dans la numérotation</p>
                <p className="mt-1">
                  Numéros manquants : {preview?.numberingGaps.join(', ')}{(preview?.numberingGaps.length ?? 0) >= 5 ? '…' : ''}. La numérotation continue est obligatoire pour un FEC d’exercice complet.
                </p>
              </div>
            </div>
          )}

          {preview?.numberingHasGaps && !isBlockingGap && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Trou(s) détecté(s) dans la numérotation ({preview.numberingGaps.join(', ')}). Vérifiez avec votre comptable.
              </p>
            </div>
          )}

          {!hasSelectedContent && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">
                Sélectionnez au moins un contenu à exporter.
              </p>
            </div>
          )}

          {hasSelectedContent && !hasDownloadableContent && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Le CSV simplifié exporte les factures émises, les avoirs ou les paiements enregistrés. Les factures fournisseurs reçues sont incluses dans le FEC.
              </p>
            </div>
          )}

          {!siren && format === 'fec' && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">
                Le SIREN est obligatoire pour générer un FEC. Complétez votre profil entreprise dans les Paramètres.
              </p>
            </div>
          )}

          {downloadError && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-4 py-3">
              <p className="text-sm text-red-700 dark:text-red-300">{downloadError}</p>
            </div>
          )}

          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            Conservez ce fichier 6 ans minimum (art. L. 102 B LPF).
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-5 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleDownload}
            disabled={isDownloading || !!isBlockingGap || !hasDownloadableContent || (!siren && format === 'fec')}
            className="flex-1 px-4 py-3 rounded-2xl bg-accent text-black font-bold text-sm flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {isDownloading
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Génération…</>
              : <><Download className="w-4 h-4" /> {format === 'fec' ? 'Télécharger le FEC' : 'Télécharger le CSV'}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
