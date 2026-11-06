'use client'
// @atelier-migrated
// Export comptable : format, période, contenu, aperçu, puis téléchargement du FEC ou du CSV.

import { useEffect, useState, useTransition } from 'react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import {
  PERIOD_OPTIONS, canDownload, defaultFilename, downloadParams, fmtEur, hasDownloadableContent, hasSelectedContent, isBlockingGap, periodRange, readErrorMessage,
  type ExportContent, type ExportFormat, type ExportPeriod, type PreviewData,
} from './exportComptableModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

type Props = { open: boolean; isVatSubject: boolean; isMicro: boolean; tvaLabel: string; siren: string | null; onClose: () => void }

/** Le parent change la `key` à chaque ouverture : l'export repart des valeurs par défaut. */
export default function ExportComptableSheet({ open, isVatSubject, isMicro, tvaLabel, siren, onClose }: Props) {
  const initial = periodRange('fiscal_year')!
  const [format, setFormat] = useState<ExportFormat>(isMicro ? 'csv' : 'fec')
  const [period, setPeriod] = useState<ExportPeriod>('fiscal_year')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [content, setContent] = useState<ExportContent>({ invoices: true, avoirs: true, payments: true, received: true })
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [loadingPreview, startPreview] = useTransition()
  const [downloading, setDownloading] = useState(false)

  function choosePeriod(p: ExportPeriod) {
    setPeriod(p)
    const range = periodRange(p)
    if (range) { setFrom(range.from); setTo(range.to) }
  }

  useEffect(() => {
    if (!open || !from || !to) return
    startPreview(async () => {
      setPreviewError(null)
      try {
        const res = await fetch('/api/exports/fec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, include_invoices: content.invoices, include_avoirs: content.avoirs, include_payments: content.payments, include_received: content.received }),
        })
        if (!res.ok) { setPreviewError(await readErrorMessage(res, 'Impossible de charger l’aperçu.')); return }
        setPreview(await res.json())
      } catch {
        setPreviewError('Erreur lors du chargement de l’aperçu.')
      }
    })
  }, [open, from, to, content])

  async function download() {
    setDownloadError(null)
    setDownloading(true)
    try {
      const res = await fetch(`/api/exports/fec?${downloadParams({ from, to, format, period, content }).toString()}`)
      if (!res.ok) { setDownloadError(await readErrorMessage(res, 'Erreur lors de la génération du fichier.')); return }
      const blob = await res.blob()
      const filename = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? defaultFilename(format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError('Erreur inattendue lors du téléchargement.')
    } finally {
      setDownloading(false)
    }
  }

  const blocking = isBlockingGap(preview, format, period)
  const allowed = canDownload({ content, format, period, preview, siren, busy: downloading })
  const setItem = (key: keyof ExportContent) => (value: boolean) => setContent(c => ({ ...c, [key]: value }))
  const contentRows: Array<[keyof ExportContent, string]> = [['invoices', 'Factures émises'], ['avoirs', 'Avoirs'], ['payments', 'Paiements enregistrés'], ['received', 'Factures fournisseurs reçues']]
  const notes: Array<{ tone: 'warn' | 'danger'; text: string }> = []
  if (isMicro) notes.push({ tone: 'warn', text: 'Micro-entrepreneur : export CSV uniquement (le FEC ne s’applique pas aux régimes micro, art. 50-0 CGI).' })
  if (!isVatSubject && !isMicro) notes.push({ tone: 'warn', text: 'Organisation en franchise art. 293 B CGI : export sans TVA.' })
  if (preview && preview.autoLiqCount > 0) notes.push({ tone: 'warn', text: `${preview.autoLiqCount} facture${preview.autoLiqCount > 1 ? 's' : ''} avec auto-liquidation de TVA (sous-traitance BTP) : vérifiez les écritures avec votre comptable.` })
  if (blocking && preview) notes.push({ tone: 'danger', text: `Trou(s) dans la numérotation : ${preview.numberingGaps.join(', ')}${preview.numberingGaps.length >= 5 ? '…' : ''}. La numérotation continue est obligatoire pour un FEC d’exercice complet.` })
  else if (preview?.numberingHasGaps) notes.push({ tone: 'warn', text: `Trou(s) détecté(s) dans la numérotation (${preview.numberingGaps.join(', ')}) : vérifiez avec votre comptable.` })
  if (!hasSelectedContent(content)) notes.push({ tone: 'danger', text: 'Sélectionnez au moins un contenu à exporter.' })
  else if (!hasDownloadableContent(content, format)) notes.push({ tone: 'warn', text: 'Le CSV simplifié exporte les factures émises, les avoirs ou les paiements. Les factures fournisseurs reçues sont incluses dans le FEC.' })
  if (!siren && format === 'fec') notes.push({ tone: 'danger', text: 'Le SIREN est obligatoire pour générer un FEC. Complétez l’identité de votre entreprise dans les réglages.' })

  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) onClose() }}
      title="Export comptable"
      onConfirm={() => void download()}
      confirmLabel="Télécharger"
      confirmLoading={downloading}
      confirmDisabled={!allowed}
    >
      <div className={local.sheetBody}>
        <ListGroup description="Détecté d’après votre entreprise.">
          <ListRow title="Régime" description={tvaLabel} />
        </ListGroup>

        <SegmentedControl
          label="Format"
          fullWidth
          value={format}
          onChange={v => setFormat(v as ExportFormat)}
          options={isMicro ? [{ value: 'csv', label: 'CSV simplifié (Excel)' }] : [{ value: 'fec', label: 'FEC' }, { value: 'csv', label: 'CSV simplifié (Excel)' }]}
        />

        <div>
          <SegmentedControl label="Période" fullWidth value={period} onChange={v => choosePeriod(v as ExportPeriod)} options={PERIOD_OPTIONS} />
          <div className={styles.fields} style={{ marginTop: 12 }}>
            <Field type="text" inputType="date" label="Du" value={from} onChange={e => { setFrom(e.target.value); setPeriod('custom') }} />
            <Field type="text" inputType="date" label="Au" value={to} onChange={e => { setTo(e.target.value); setPeriod('custom') }} />
          </div>
        </div>

        <ListGroup title="Contenu">
          {contentRows.map(([key, label]) => (
            <ListRow key={key} title={label} trailing={<Switch label={label} checked={content[key]} onChange={setItem(key)} />} />
          ))}
        </ListGroup>

        <ListGroup title={loadingPreview ? 'Aperçu (mise à jour…)' : 'Aperçu'} description={format === 'fec' && preview ? `Écritures estimées : environ ${preview.estimatedLines}.` : undefined}>
          {previewError && <ListRow title="Aperçu indisponible" description={previewError} />}
          {preview && !previewError && (
            <>
              <ListRow title="Factures" description={String(preview.invoiceCount)} />
              <ListRow title="Avoirs" description={String(preview.avoirCount)} />
              <ListRow title="Paiements" description={String(preview.paymentCount)} />
              <ListRow title="Factures reçues" description={String(preview.receivedInvoiceCount)} />
              {isVatSubject && preview.vatBreakdowns.base20 > 0 && <ListRow title="Base HT 20 %" description={fmtEur(preview.vatBreakdowns.base20)} />}
              {isVatSubject && preview.vatBreakdowns.base10 > 0 && <ListRow title="Base HT 10 %" description={fmtEur(preview.vatBreakdowns.base10)} />}
              {isVatSubject && preview.vatBreakdowns.base55 > 0 && <ListRow title="Base HT 5,5 %" description={fmtEur(preview.vatBreakdowns.base55)} />}
              {isVatSubject && <ListRow title="TVA collectée" description={fmtEur(preview.vatBreakdowns.total)} />}
            </>
          )}
          {!preview && !previewError && <ListRow title="Chargement…" />}
        </ListGroup>

        {notes.map(n => <p key={n.text} className={local.notice} data-tone={n.tone} role={n.tone === 'danger' ? 'alert' : 'status'}>{n.text}</p>)}
        {downloadError && <p className={screen.error} role="alert">{downloadError}</p>}
        <p className={styles.hint}>Conservez ce fichier 6 ans minimum (art. L. 102 B LPF).</p>
      </div>
    </Sheet>
  )
}
