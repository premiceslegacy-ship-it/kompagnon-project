'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mic, MicOff, FileText, Loader2, Upload,
  CheckCircle2, AlertCircle, RotateCcw, ChevronRight, ChevronLeft, X, ImageIcon,
  Ruler, ClipboardList,
} from 'lucide-react'
import {
  createQuoteFromAIResult,
} from '@/lib/data/mutations/quotes'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import type { PlanMeasurementItem, PlanMeasurementResult } from '@/app/api/ai/measure-plan/route'
import { AI_NAME } from '@/lib/brand'
import { AssistantAvatar } from '@/components/ai/AssistantAvatar'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Mode = 'voice' | 'text' | 'pdf' | 'measure'
type MeasurementSettings = {
  defaultHeightM: number
  wastePct: number
  studSpacingM: number
}

const ACCEPTED_FILE_TYPES = '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg,image/jpg'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

const fmtPrice = (n: number) =>
  n > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n) : '-'

const splitDetails = (description: string | null | undefined) => {
  const parts = (description ?? '').split(/\n\n?Comprend\s*:\s*/i)
  return {
    designation: parts[0]?.trim() ?? '',
    details: parts.length > 1 ? parts.slice(1).join('\nComprend : ').trim() : '',
  }
}

function roundMeasurement(value: number): number {
  return Math.round(value * 100) / 100
}

function tokenizeFormula(expression: string): string[] {
  const compact = expression.replace(/\s+/g, '')
  const tokens = compact.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[()+\-*/]/g) ?? []
  if (tokens.join('') !== compact) throw new Error('Formule invalide')
  return tokens
}

function evaluateFormula(expression: string, variables: Record<string, number>): number {
  const tokens = tokenizeFormula(expression)
  let index = 0

  const peek = () => tokens[index]
  const next = () => tokens[index++]

  function parseFactor(): number {
    const token = next()
    if (token == null) throw new Error('Formule incomplète')
    if (token === '+') return parseFactor()
    if (token === '-') return -parseFactor()
    if (token === '(') {
      const value = parseExpression()
      if (next() !== ')') throw new Error('Parenthèse manquante')
      return value
    }
    if (/^\d/.test(token)) return Number(token.replace(',', '.'))
    if (/^[A-Za-z_]/.test(token)) return variables[token] ?? 0
    throw new Error('Formule invalide')
  }

  function parseTerm(): number {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const rhs = parseFactor()
      if (op === '*') value *= rhs
      else {
        if (rhs === 0) throw new Error('Division par zéro')
        value /= rhs
      }
    }
    return value
  }

  function parseExpression(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const result = parseExpression()
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Formule invalide')
  return Math.max(0, roundMeasurement(result))
}

function defaultFormulaForItem(item: PlanMeasurementItem): string {
  const mode = item.dimension_pricing_mode
  if (mode === 'linear') return 'L * N * (1 + waste)'
  if (mode === 'volume') return 'L * W * H * N * (1 + waste)'
  if (mode === 'area') {
    if (item.width_m != null) return 'L * W * N * (1 + waste)'
    if (item.height_m != null) return '(L * H - O) * N * (1 + waste)'
    return 'A * N * (1 + waste)'
  }
  return 'quantity'
}

function formulaVariablesForItem(item: PlanMeasurementItem, settings: MeasurementSettings): Record<string, number> {
  const provided = item.formulaVariables ?? {}
  return {
    quantity: item.quantity,
    L: item.length_m ?? provided.L ?? provided.length_m ?? 0,
    W: item.width_m ?? provided.W ?? provided.width_m ?? 0,
    H: item.height_m ?? provided.H ?? provided.height_m ?? settings.defaultHeightM,
    N: item.dim_quantity ?? provided.N ?? provided.dim_quantity ?? 1,
    A: provided.A ?? provided.area_m2 ?? (item.length_m && item.width_m ? item.length_m * item.width_m : 0),
    P: provided.P ?? provided.perimeter_m ?? item.length_m ?? 0,
    O: provided.O ?? provided.openings_m2 ?? 0,
    waste: settings.wastePct / 100,
    spacing: settings.studSpacingM,
  }
}

// ─── 3D Icon Wrapper ──────────────────────────────────────────────────────────
// Applies layered drop-shadows + gradient tint for sculpted depth effect

function Icon3D({
  children,
  size = 56,
  accent = false,
  className = '',
}: {
  children: React.ReactNode
  size?: number
  accent?: boolean
  className?: string
}) {
  const radius = Math.round(size * 0.36)
  return (
    <div
      className={`relative shrink-0 flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: accent
          ? 'linear-gradient(145deg, rgb(var(--accent-primary) / 0.22) 0%, rgb(var(--accent-primary) / 0.08) 100%)'
          : 'linear-gradient(145deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.03) 100%)',
        border: accent
          ? '1px solid rgb(var(--accent-primary) / 0.3)'
          : '1px solid var(--elevation-border)',
        boxShadow: accent
          ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 0 0 var(--hard-edge), 0 4px 0 1px var(--shadow-ring), 0 8px 20px var(--shadow-drop-strong)'
          : 'inset 0 1px 0 var(--inner-highlight), 0 3px 0 0 var(--hard-edge), 0 3px 0 1px var(--shadow-ring), 0 6px 14px var(--shadow-drop)',
      }}
    >
      {children}
    </div>
  )
}

function DocumentChoiceModal({ onClose, onSelectQuote, onSelectMeasure }: {
  onClose: () => void
  onSelectQuote: () => void
  onSelectMeasure: () => void
}) {
  return (
    <div className="modal-overlay">
      <div className="modal-panel sm:max-w-2xl">
        <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4 border-b border-[var(--elevation-border)]">
          <div>
            <h2 className="text-base font-bold text-primary">Importer un document</h2>
            <p className="text-xs text-secondary">Choisissez comment Chloé doit l’analyser</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-base transition-colors"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 grid gap-4 sm:grid-cols-2 bg-base/50">
          <button
            type="button"
            onClick={onSelectQuote}
            className="card p-5 text-left hover:border-accent/50 hover:bg-accent/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
              <ClipboardList className="w-5 h-5 text-accent" />
            </div>
            <p className="text-sm font-bold text-primary">Créer un devis classique</p>
            <p className="text-xs text-secondary mt-1">PDF, CCTP, email client ou cahier des charges. Chloé extrait les postes et prépare le devis.</p>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent">
              Analyser le document <ChevronRight className="w-4 h-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={onSelectMeasure}
            className="card p-5 text-left hover:border-accent/50 hover:bg-accent/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
              <Ruler className="w-5 h-5 text-accent" />
            </div>
            <p className="text-sm font-bold text-primary">Faire un pré-métré depuis un plan</p>
            <p className="text-xs text-secondary mt-1">Plan PDF ou photo. Chloé détecte pièces, surfaces et quantités à valider avant devis.</p>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent">
              Préparer le métré <Ruler className="w-4 h-4" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

function joinNotes(label: string, values: string[] | undefined) {
  return values?.length ? `${label} : ${values.join(' ; ')}` : null
}

function measurementToQuote(measurement: PlanMeasurementResult): AIQuoteResult {
  const grouped = new Map<string, PlanMeasurementItem[]>()
  for (const item of measurement.items) {
    const key = item.roomName?.trim() || 'Général'
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }

  const quoteWarnings = [
    ...measurement.globalWarnings,
    ...(measurement.needsCalibration ? ['Échelle ou cotes à confirmer avant devis définitif.'] : []),
    ...measurement.items
      .filter(item => item.confidence != null && item.confidence < 0.65)
      .slice(0, 5)
      .map(item => `${item.roomName} - ${item.designation} : confiance faible, à vérifier.`),
  ]

  return {
    title: measurement.title || 'Pré-métré depuis plan',
    clientName: null,
    clientDraft: null,
    quoteWarnings,
    sections: [...grouped.entries()].map(([roomName, items]) => ({
      title: roomName,
      items: items.map(item => {
        const details = [
          item.trade ? `Lot : ${item.trade}` : null,
          item.formula ? `Formule : ${item.formula}` : null,
          joinNotes('Hypothèses', item.assumptions),
          joinNotes('À vérifier', item.warnings),
          'Prix à renseigner après validation du métré.',
        ].filter(Boolean).join('\n')
        return {
          designation: item.designation,
          details,
          description: `${item.designation}\n\nComprend :\n${details}`,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: 0,
          unit_cost_ht: null,
          vat_rate: 20,
          is_estimated: true,
          is_internal: false,
          ai_confidence: item.confidence ?? null,
          ai_source: 'document' as const,
          ai_warnings: item.warnings ?? [],
          dim_quantity: item.dim_quantity ?? 1,
          length_m: item.length_m ?? null,
          width_m: item.width_m ?? null,
          height_m: item.height_m ?? null,
          dimension_pricing_mode: item.dimension_pricing_mode ?? null,
        }
      }),
    })),
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AtelierIAClient() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('voice')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pdfDescription, setPdfDescription] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStage, setAnalyzeStage] = useState('Préparation')
  const [isCreating, setIsCreating] = useState(false)
  const [results, setResults] = useState<AIQuoteResult[]>([])
  const [measurement, setMeasurement] = useState<PlanMeasurementResult | null>(null)
  const [measurementSettings, setMeasurementSettings] = useState<MeasurementSettings>({ defaultHeightM: 2.5, wastePct: 8, studSpacingM: 0.6 })
  const [formulaError, setFormulaError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [creditsError, setCreditsError] = useState(false)
  const [briefBanner, setBriefBanner] = useState<string | null>(null)
  const [documentChoiceOpen, setDocumentChoiceOpen] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Brief Sarah → Chloé : vérifier en base au montage ──────────────────
  useEffect(() => {
    // D'abord le sessionStorage (compat ancienne logique)
    const stored = sessionStorage.getItem('sarah_brief_chloe')
    if (stored) {
      try {
        const brief = JSON.parse(stored)
        sessionStorage.removeItem('sarah_brief_chloe')
        if (brief.description?.trim()) {
          setText(brief.description.trim())
          setMode('text')
          setBriefBanner(`Brief transmis par Sarah${brief.client_name ? ` pour ${brief.client_name}` : ''}.`)
        }
      } catch { /* ignore */ }
      return
    }
    // Sinon vérifier la table ai_briefs
    fetch('/api/sarah/briefs?target=chloe')
      .then(r => r.json())
      .then(({ brief }) => {
        if (!brief) return
        const payload = brief.payload ?? {}
        if (payload.description?.trim()) {
          setText(payload.description.trim())
          setMode('text')
          setBriefBanner(`Brief transmis par Sarah${payload.client_name ? ` pour ${payload.client_name}` : ''}.`)
          // Marquer comme consommé
          fetch('/api/sarah/briefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ briefId: brief.id }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  // ─── MediaRecorder → Mistral transcription ───────────────────────────────

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setIsTranscribing(true)
        try {
          const fd = new FormData()
          fd.append('audio', blob, 'recording.webm')
          const res = await fetch('/api/ai/transcribe-audio', { method: 'POST', body: fd })
          const data = await res.json()
          if (!res.ok) setError(data.error ?? 'Erreur transcription')
          else setText(data.text ?? '')
        } catch {
          setError('Impossible de transcrire l\'audio.')
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      setError('Accès micro refusé ou non disponible.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }, [])

  useEffect(() => () => { mediaRecorderRef.current?.stop() }, [])

  // ─── Analyze ─────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setResults([])
    setMeasurement(null)
    setFormulaError(null)
    setCurrentIndex(0)
    setAnalyzeStage(mode === 'pdf' ? 'Lecture du document' : mode === 'measure' ? 'Lecture du plan' : 'Recherche catalogue')

    try {
      let res: Response
      if ((mode === 'pdf' || mode === 'measure') && file) {
        const formData = new FormData()
        formData.append('file', file)
        if (pdfDescription.trim()) formData.append('description', pdfDescription.trim())
        setAnalyzeStage(mode === 'measure' ? 'Détection pièces et quantités' : 'OCR et lecture du document')
        res = await fetch(mode === 'measure' ? '/api/ai/measure-plan' : '/api/ai/analyze-quote', { method: 'POST', body: formData })
      } else {
        setAnalyzeStage('Recherche catalogue')
        res = await fetch('/api/ai/analyze-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      }
      setAnalyzeStage('Vérification marge')
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 402) { setCreditsError(true); return }
        setError(data.error ?? 'Erreur inconnue')
      } else if (mode === 'measure') {
        const nextMeasurement = (data as { measurement?: PlanMeasurementResult }).measurement ?? null
        if (!nextMeasurement?.items?.length) setError('Aucun métré exploitable trouvé. Essayez un plan plus lisible ou ajoutez des précisions.')
        else {
          setFormulaError(null)
          setMeasurement({
            ...nextMeasurement,
            items: nextMeasurement.items.map(item => ({
              ...item,
              formula: item.formula?.trim() || defaultFormulaForItem(item),
            })),
          })
        }
      } else setResults((data as { quotes: AIQuoteResult[] }).quotes ?? [])
    } catch {
      setError('Impossible de contacter l\'IA. Vérifiez votre connexion.')
    } finally {
      setIsAnalyzing(false)
      setAnalyzeStage('Préparation')
    }
  }

  // ─── Créer dans l'éditeur ─────────────────────────────────────────────────

  async function handleCreateInEditor() {
    if (results.length === 0) return
    setIsCreating(true)
    setError(null)

    try {
      const createdIds: string[] = []
      for (const quote of results) {
        const quoteRes = await createQuoteFromAIResult(quote)
        if (quoteRes.error || !quoteRes.quoteId) {
          setError(quoteRes.error ?? 'Impossible de créer le devis')
          setIsCreating(false)
          return
        }
        createdIds.push(quoteRes.quoteId)
      }

      const targetId = createdIds[currentIndex] ?? createdIds[0]
      const params = new URLSearchParams({ id: targetId, returnTo: '/atelier-ia' })
      router.push(`/finances/quote-editor?${params}`)
    } catch {
      setError('Erreur lors de la création du devis')
      setIsCreating(false)
    }
  }

  async function handleCreateMeasurementInEditor() {
    if (!measurement) return
    setIsCreating(true)
    setError(null)

    try {
      const quoteRes = await createQuoteFromAIResult(measurementToQuote(measurement))
      if (quoteRes.error || !quoteRes.quoteId) {
        setError(quoteRes.error ?? 'Impossible de créer le devis')
        setIsCreating(false)
        return
      }
      const params = new URLSearchParams({ id: quoteRes.quoteId, returnTo: '/atelier-ia' })
      router.push(`/finances/quote-editor?${params}`)
    } catch {
      setError('Erreur lors de la création du devis')
      setIsCreating(false)
    }
  }

  function handleReset() {
    setText('')
    setFile(null)
    setPdfDescription('')
    setResults([])
    setMeasurement(null)
    setFormulaError(null)
    setCurrentIndex(0)
    setError(null)
  }

  function handleModeChange(m: Mode) {
    if (isRecording) stopRecording()
    setMode(m)
    setDocumentChoiceOpen(false)
    handleReset()
  }

  function handleDocumentModeClick() {
    if (isRecording) stopRecording()
    setDocumentChoiceOpen(true)
  }

  function updateMeasurementItem(index: number, patch: Partial<PlanMeasurementItem>) {
    setFormulaError(null)
    setMeasurement(current => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item),
      }
    })
  }

  function recalculateMeasurementItem(index: number) {
    setMeasurement(current => {
      if (!current) return current
      const item = current.items[index]
      if (!item) return current
      try {
        const formula = item.formula?.trim() || defaultFormulaForItem(item)
        const quantity = evaluateFormula(formula, formulaVariablesForItem(item, measurementSettings))
        setFormulaError(null)
        return {
          ...current,
          items: current.items.map((row, i) => i === index ? { ...row, formula, quantity } : row),
        }
      } catch (err) {
        setFormulaError(err instanceof Error ? err.message : 'Formule invalide')
        return current
      }
    })
  }

  function recalculateAllMeasurementItems() {
    setMeasurement(current => {
      if (!current) return current
      try {
        const items = current.items.map(item => {
          const formula = item.formula?.trim() || defaultFormulaForItem(item)
          return {
            ...item,
            formula,
            quantity: evaluateFormula(formula, formulaVariablesForItem(item, measurementSettings)),
          }
        })
        setFormulaError(null)
        return { ...current, items }
      } catch (err) {
        setFormulaError(err instanceof Error ? err.message : 'Une formule est invalide')
        return current
      }
    })
  }

  const currentQuote = results[currentIndex] ?? null
  const canAnalyze = mode === 'pdf' || mode === 'measure' ? !!file : text.trim().length >= 5
  const totalItems = currentQuote?.sections.reduce((s: number, sec: AIQuoteResult['sections'][0]) => s + sec.items.length, 0) ?? 0
  const documentModeActive = mode === 'pdf' || mode === 'measure'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8 space-y-6">
      {creditsError && <AICreditsErrorModal onClose={() => setCreditsError(false)} />}
      {documentChoiceOpen && (
        <DocumentChoiceModal
          onClose={() => setDocumentChoiceOpen(false)}
          onSelectQuote={() => handleModeChange('pdf')}
          onSelectMeasure={() => handleModeChange('measure')}
        />
      )}

      {/* Header */}
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <AssistantAvatar assistant="chloe" size={56} className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-primary">{AI_NAME}</h1>
              <p className="text-sm text-secondary">Assistante de génération de devis</p>
            </div>
          </div>
        </div>
        {briefBanner && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[rgb(var(--accent-primary)/0.08)] border border-[rgb(var(--accent-primary)/0.2)] text-xs text-[rgb(var(--accent-primary))] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {briefBanner}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-240px)]">

        {/* ── Left panel - Input ───────────────────────────────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="card overflow-hidden flex flex-col flex-1 min-h-[560px]">
            <div className="px-5 py-4 border-b border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.04]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Source</p>
              <h2 className="text-lg font-bold text-primary mt-0.5">Entrée projet</h2>
            </div>

            <div className="p-5 flex flex-col flex-1 gap-5">

              {/* Mode switcher */}
              <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] border border-[var(--elevation-border)]">
                {([
                  { id: 'voice', label: 'Vocal', icon: Mic },
                  { id: 'text', label: 'Texte', icon: FileText },
                  { id: 'pdf', label: 'Document', icon: ImageIcon },
                ] as const).map(({ id, label, icon: IconComp }) => (
                  <button
                    key={id}
                    onClick={() => id === 'pdf' ? handleDocumentModeClick() : handleModeChange(id)}
                    className={`h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all border ${
                      mode === id || (id === 'pdf' && documentModeActive)
                        ? 'bg-[var(--bg-surface)] dark:bg-white/[0.09] text-primary border-[var(--elevation-border)] shadow-[inset_0_1px_0_var(--inner-highlight),0_3px_0_0_var(--hard-edge),0_3px_0_1px_var(--shadow-ring),0_6px_12px_var(--shadow-drop)]'
                        : 'text-secondary border-transparent hover:text-primary hover:bg-white/[0.04]'
                    }`}
                  >
                    <IconComp
                      className="w-3.5 h-3.5"
                      style={{ strokeWidth: '2.5', filter: mode === id || (id === 'pdf' && documentModeActive) ? 'var(--icon-depth-filter)' : undefined }}
                    />
                    {id === 'pdf' && mode === 'measure' ? 'Plan' : label}
                  </button>
                ))}
              </div>

              {/* Input zone */}
              <div className="flex-1 flex flex-col">

                {mode === 'voice' && (
                  <div className="flex-1 flex flex-col gap-4">
                    <p className="text-xs text-secondary">Décrivez les travaux à voix haute. {AI_NAME} structure le devis pour vous.</p>
                    <div className="flex-1 min-h-[280px] rounded-2xl border border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.035] flex flex-col items-center justify-center gap-6 p-6">
                      {/* Bouton micro 3D */}
                      <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className={`w-28 h-28 rounded-full flex items-center justify-center transition-all border-2 ${
                          isRecording
                            ? 'bg-red-500 border-red-700/40 animate-pulse shadow-[inset_0_2px_0_rgba(255,255,255,0.3),0_6px_0_0_#7f1d1d,0_6px_0_1px_rgba(127,29,29,0.2),0_14px_28px_rgba(239,68,68,0.4)]'
                            : 'bg-gradient-to-b from-[rgb(var(--accent-primary)/0.9)] to-[rgb(var(--accent-primary))] border-[rgba(0,0,0,0.15)] shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_6px_0_0_var(--hard-edge),0_6px_0_1px_var(--shadow-ring),0_14px_28px_rgba(0,0,0,0.35)] hover:shadow-[inset_0_2px_0_rgba(255,255,255,0.4),0_8px_0_0_var(--hard-edge),0_8px_0_1px_var(--shadow-ring),0_18px_36px_rgba(0,0,0,0.45)] hover:-translate-y-0.5'
                        }`}
                      >
                        {isRecording
                          ? <MicOff className="w-10 h-10 text-white" style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.5))', strokeWidth: '2.5' }} />
                          : <Mic className="w-10 h-10 text-black/80" style={{ filter: 'var(--icon-on-accent-filter)', strokeWidth: '2.5' }} />
                        }
                      </button>
                      <p className="text-sm font-medium text-secondary">
                        {isRecording
                          ? 'Enregistrement... (cliquez pour arrêter)'
                          : isTranscribing
                            ? 'Transcription en cours...'
                            : 'Cliquez pour parler'
                        }
                      </p>
                    </div>
                    {isTranscribing && (
                      <div className="flex items-center gap-2 text-sm text-secondary">
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
                        Transcription en cours...
                      </div>
                    )}
                    {text && (
                      <div className="max-h-52 p-4 rounded-2xl bg-[var(--bg-base)] border border-[var(--elevation-border)] shadow-[inset_0_1px_0_var(--inner-highlight)] overflow-y-auto">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2">Transcription</p>
                        <p className="text-sm text-primary leading-relaxed">{text}</p>
                      </div>
                    )}
                  </div>
                )}

                {mode === 'text' && (
                  <div className="flex-1 flex flex-col gap-2">
                    <p className="text-xs text-secondary">Décrivez librement les travaux à réaliser.</p>
                    <textarea
                      value={text}
                      onChange={e => setText(e.target.value)}
                      placeholder="Ex: Rénovation complète d'une salle de bain de 8m2 : dépose de l'ancien carrelage, pose nouveau carrelage sol et mur (format 60×60), remplacement de la baignoire par une douche à l'italienne 90×90, changement du lavabo et robinetterie, peinture plafond..."
                      className="input flex-1 min-h-[22rem] max-h-full overflow-y-auto p-4 rounded-2xl text-sm resize-y leading-relaxed placeholder:text-secondary/50"
                    />
                  </div>
                )}

                {(mode === 'pdf' || mode === 'measure') && (
                  <div className="flex-1 flex flex-col gap-2">
                    <p className="text-xs text-secondary">
                      {mode === 'measure'
                        ? `Importez un plan PDF ou une photo de plan. ${AI_NAME} prépare un pré-métré à valider.`
                        : `Importez un cahier des charges PDF, une demande client ou une photo de document. ${AI_NAME} extrait les postes pour vous.`}
                    </p>
                    {!file ? (
                      <div
                        className="flex-1 min-h-[320px] border-2 border-dashed border-[var(--elevation-border)] rounded-2xl flex flex-col items-center justify-center gap-5 text-secondary hover:border-[rgb(var(--accent-primary)/0.6)] hover:bg-[rgb(var(--accent-primary)/0.04)] transition-all cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          const dropped = e.dataTransfer.files[0]
                          if (dropped && ACCEPTED_MIME_TYPES.has(dropped.type)) { setFile(dropped); setError(null) }
                          else setError('Formats acceptés : PDF, PNG, JPEG')
                        }}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ACCEPTED_FILE_TYPES}
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0]
                            if (f) { setFile(f); setError(null) }
                          }}
                        />
                        <Icon3D size={56} accent>
                          <Upload
                            className="w-6 h-6 text-[var(--accent-primary)]"
                            style={{ strokeWidth: '2.5', filter: 'var(--icon-depth-filter)' }}
                          />
                        </Icon3D>
                        <div className="text-center">
                          <p className="font-semibold text-primary text-sm">Glissez votre document ici</p>
                          <p className="text-xs text-secondary mt-1">PDF, PNG ou JPEG — max 10 Mo</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col gap-4">
                        <div className="rounded-2xl border border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.035] shadow-[inset_0_1px_0_var(--inner-highlight)] flex flex-col items-center justify-center gap-4 p-5">
                          {file.type.startsWith('image/') ? (
                            <img
                              src={URL.createObjectURL(file)}
                              alt="Aperçu"
                              className="max-h-44 rounded-xl object-contain border border-[var(--elevation-border)] shadow-[0_4px_0_0_var(--hard-edge),0_4px_0_1px_var(--shadow-ring),0_8px_16px_var(--shadow-drop)]"
                            />
                          ) : (
                            <Icon3D size={64} accent>
                              <FileText
                                className="w-8 h-8 text-[var(--accent-primary)]"
                                style={{ strokeWidth: '2', filter: 'var(--icon-depth-filter)' }}
                              />
                            </Icon3D>
                          )}
                          <div className="text-center">
                            <p className="font-semibold text-primary text-sm">{file.name}</p>
                            <p className="text-xs text-secondary mt-1">{(file.size / 1024).toFixed(0)} Ko</p>
                          </div>
                          <button
                            onClick={() => setFile(null)}
                            className="btn-secondary h-8 px-3 text-xs flex items-center gap-1.5"
                          >
                            <X className="w-3.5 h-3.5" /> Supprimer
                          </button>
                        </div>

                        <div>
                          <label className="text-xs text-secondary font-medium mb-1.5 block">
                            Précisions pour {AI_NAME} <span className="opacity-50 font-normal">(optionnel)</span>
                          </label>
                          <textarea
                            value={pdfDescription}
                            onChange={e => setPdfDescription(e.target.value)}
                            placeholder={mode === 'measure'
                              ? "Ex: Hauteur sous plafond 2,50 m. Fais surtout le placo : cloisons, doublages, plafonds, bandes. Ignore l'électricité."
                              : "Ex: Concentre-toi sur la partie plomberie. Ignore les pages administratives. TVA à 10% car rénovation d'un logement existant."}
                            rows={5}
                            className="input w-full min-h-[8rem] max-h-[16rem] overflow-y-auto p-3 rounded-xl text-sm resize-y leading-relaxed placeholder:text-secondary/50"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
                </div>
              )}

              {/* Analyze button */}
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze || isAnalyzing}
                className="btn-primary w-full h-14 rounded-2xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {AI_NAME} analyse...
                  </>
                ) : (
                  <>
                    {mode === 'measure'
                      ? <Ruler className="w-5 h-5" style={{ strokeWidth: '2.5' }} />
                      : <AssistantAvatar assistant="chloe" size={20} className="border-none bg-transparent shadow-none !rounded-full" />}
                    {mode === 'measure' ? 'Analyser le plan' : `Confier à ${AI_NAME}`}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right panel - Result ─────────────────────────────────────────── */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="card overflow-hidden flex-1 flex flex-col min-h-[560px]">
            <div className="px-5 py-4 border-b border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.04] flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Sortie</p>
                <h2 className="text-lg font-bold text-primary mt-0.5">{mode === 'measure' ? 'Pré-métré à valider' : 'Devis structuré'}</h2>
              </div>
              {(currentQuote || measurement) && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-400 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {mode === 'measure' ? 'À vérifier' : 'Validé'}
                </span>
              )}
            </div>

            <div className="p-5 flex-1 flex flex-col overflow-hidden">

              {!currentQuote && !measurement && !isAnalyzing && (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 text-secondary">
                  {mode === 'measure'
                    ? <Icon3D size={80} accent><Ruler className="w-9 h-9 text-[var(--accent-primary)]" /></Icon3D>
                    : <AssistantAvatar assistant="chloe" size={80} />}
                  <div className="text-center">
                    <p className="font-semibold text-primary">{mode === 'measure' ? 'Prêt à mesurer' : 'Prêt à générer'}</p>
                    <p className="text-sm text-secondary mt-1.5 max-w-[260px]">
                      {mode === 'measure'
                        ? 'Importez un plan à gauche. Chloé préparera les quantités à valider ici.'
                        : `Décrivez votre projet à gauche. ${AI_NAME} structure le devis ici.`}
                    </p>
                  </div>
                </div>
              )}

              {isAnalyzing && (
                <div className="flex-1 flex flex-col items-center justify-center gap-5">
                  {/* Spinner 3D */}
                  <div
                    className="w-16 h-16 rounded-full border-4 animate-spin"
                    style={{
                      borderColor: 'rgb(var(--accent-primary) / 0.2)',
                      borderTopColor: 'rgb(var(--accent-primary))',
                      filter: 'drop-shadow(0 2px 8px rgb(var(--accent-primary) / 0.35))',
                    }}
                  />
                  <p className="font-bold text-primary">{AI_NAME} analyse...</p>
                  <p className="text-xs text-secondary">{analyzeStage}</p>
                </div>
              )}

              {measurement && mode === 'measure' && (
                <div className="flex flex-col h-full">
                  <div className="flex flex-col gap-3 mb-4 shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-primary truncate">{measurement.title}</p>
                        <p className="text-xs text-secondary">
                          {measurement.rooms.length} pièce{measurement.rooms.length > 1 ? 's' : ''} · {measurement.items.length} ligne{measurement.items.length > 1 ? 's' : ''} de métré
                        </p>
                      </div>
                      <button
                        onClick={handleReset}
                        className="btn-secondary h-9 px-3 text-xs flex items-center gap-1.5 shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" style={{ strokeWidth: '2.5' }} /> Recommencer
                      </button>
                    </div>

                    {(measurement.needsCalibration || measurement.globalWarnings.length > 0) && (
                      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 space-y-2">
                        {measurement.needsCalibration && (
                          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>Échelle ou cotes à confirmer avant devis définitif.</span>
                          </div>
                        )}
                        {measurement.globalWarnings.slice(0, 4).map((warning, wi) => (
                          <div key={wi} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{warning}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="rounded-2xl border border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.035] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Paramètres de calcul</p>
                          <p className="text-xs text-secondary mt-0.5">Variables disponibles : L, W, H, N, A, P, O, waste, spacing.</p>
                        </div>
                        <label className="text-[11px] text-secondary font-medium">
                          H défaut
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={measurementSettings.defaultHeightM}
                            onChange={e => setMeasurementSettings(s => ({ ...s, defaultHeightM: Math.max(0, Number(e.target.value) || 0) }))}
                            className="input mt-1 h-9 w-24 px-2 rounded-lg text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-secondary font-medium">
                          Pertes %
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={measurementSettings.wastePct}
                            onChange={e => setMeasurementSettings(s => ({ ...s, wastePct: Math.max(0, Number(e.target.value) || 0) }))}
                            className="input mt-1 h-9 w-24 px-2 rounded-lg text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-secondary font-medium">
                          Entraxe m
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={measurementSettings.studSpacingM}
                            onChange={e => setMeasurementSettings(s => ({ ...s, studSpacingM: Math.max(0, Number(e.target.value) || 0) }))}
                            className="input mt-1 h-9 w-24 px-2 rounded-lg text-xs"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={recalculateAllMeasurementItems}
                          className="btn-secondary h-9 px-3 text-xs flex items-center gap-1.5"
                        >
                          <Ruler className="w-3.5 h-3.5" /> Recalculer tout
                        </button>
                      </div>
                      {formulaError && (
                        <p className="mt-2 text-xs text-red-500 dark:text-red-400">{formulaError}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto rounded-2xl border border-[var(--elevation-border)]">
                    <div className="min-w-[820px]">
                      <div className="grid grid-cols-[130px_190px_90px_80px_1fr_95px] gap-2 px-3 py-2 bg-black/[0.04] dark:bg-white/[0.06] border-b border-[var(--elevation-border)] text-[10px] font-bold uppercase tracking-widest text-secondary">
                        <span>Pièce</span>
                        <span>Poste</span>
                        <span>Qté</span>
                        <span>Unité</span>
                        <span>Hypothèses</span>
                        <span>Confiance</span>
                      </div>
                      {measurement.items.map((item, index) => (
                        <div key={index} className="grid grid-cols-[130px_190px_90px_80px_1fr_95px] gap-2 px-3 py-3 border-b border-[var(--elevation-border)] last:border-b-0 items-start">
                          <input
                            value={item.roomName}
                            onChange={e => updateMeasurementItem(index, { roomName: e.target.value })}
                            className="input h-9 px-2 rounded-lg text-xs"
                          />
                          <div className="space-y-1">
                            <input
                              value={item.designation}
                              onChange={e => updateMeasurementItem(index, { designation: e.target.value })}
                              className="input h-9 px-2 rounded-lg text-xs font-semibold"
                            />
                            <input
                              value={item.trade}
                              onChange={e => updateMeasurementItem(index, { trade: e.target.value })}
                              className="input h-8 px-2 rounded-lg text-[11px] text-secondary"
                            />
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={Number.isFinite(item.quantity) ? item.quantity : 0}
                            onChange={e => updateMeasurementItem(index, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                            className="input h-9 px-2 rounded-lg text-xs tabular-nums"
                          />
                          <input
                            value={item.unit}
                            onChange={e => updateMeasurementItem(index, { unit: e.target.value })}
                            className="input h-9 px-2 rounded-lg text-xs"
                          />
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-4 gap-1.5">
                              {([
                                ['L', 'length_m'],
                                ['W', 'width_m'],
                                ['H', 'height_m'],
                                ['N', 'dim_quantity'],
                              ] as const).map(([label, field]) => (
                                <label key={field} className="text-[10px] text-secondary">
                                  {label}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={(item[field] ?? '') as string | number}
                                    onChange={e => {
                                      const raw = e.target.value
                                      const value = raw === '' ? null : Math.max(0, Number(raw) || 0)
                                      updateMeasurementItem(index, field === 'dim_quantity' ? { dim_quantity: value ?? 1 } : { [field]: value } as Partial<PlanMeasurementItem>)
                                    }}
                                    className="input mt-0.5 h-7 px-1.5 rounded-md text-[11px]"
                                  />
                                </label>
                              ))}
                            </div>
                            <textarea
                              value={item.formula ?? defaultFormulaForItem(item)}
                              onChange={e => updateMeasurementItem(index, { formula: e.target.value })}
                              rows={1}
                              className="input w-full min-h-[2.25rem] px-2 py-1.5 rounded-lg text-xs resize-y font-mono"
                              placeholder="Ex: (L * H - O) * N * (1 + waste)"
                            />
                            <textarea
                              value={(item.assumptions ?? []).join('\n')}
                              onChange={e => updateMeasurementItem(index, { assumptions: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) })}
                              rows={2}
                              className="input w-full min-h-[4.25rem] px-2 py-1.5 rounded-lg text-xs resize-y"
                              placeholder="Hypothèses utilisées..."
                            />
                            {(item.warnings?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {item.warnings!.slice(0, 2).map((warning, wi) => (
                                  <span key={wi} className="px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">{warning}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <span className={`inline-flex w-full justify-center px-2 py-1 rounded-lg text-xs font-semibold border ${
                              (item.confidence ?? 0) >= 0.8
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                                : (item.confidence ?? 0) >= 0.6
                                ? 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                                : 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300'
                            }`}>
                              {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : 'n/a'}
                            </span>
                            {(item.length_m || item.width_m || item.height_m) && (
                              <p className="text-[10px] text-secondary leading-snug">
                                {[item.length_m ? `L ${item.length_m}m` : null, item.width_m ? `l ${item.width_m}m` : null, item.height_m ? `H ${item.height_m}m` : null].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => recalculateMeasurementItem(index)}
                              className="btn-secondary h-7 w-full px-2 text-[10px]"
                            >
                              Recalculer
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 shrink-0 border-t border-[var(--elevation-border)] pt-4">
                    <button
                      onClick={handleCreateMeasurementInEditor}
                      disabled={isCreating || measurement.items.length === 0}
                      className="btn-primary w-full h-14 rounded-2xl text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2.5"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Création en cours...
                        </>
                      ) : (
                        <>
                          <FileText className="w-5 h-5" style={{ strokeWidth: '2.5' }} />
                          Générer le devis depuis ce métré
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                    <p className="text-xs text-secondary text-center mt-2">
                      Le devis sera créé avec les quantités validées. Les prix resteront à renseigner dans l’éditeur.
                    </p>
                  </div>
                </div>
              )}

              {currentQuote && (
                <div className="flex flex-col h-full">
                  {/* Result header */}
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" style={{ filter: 'var(--icon-depth-filter)' }} />
                      <span className="font-bold text-primary">
                        {currentQuote.sections.length} section{currentQuote.sections.length > 1 ? 's' : ''} · {totalItems} ligne{totalItems > 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={handleReset}
                      className="btn-secondary h-9 px-3 text-xs flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" style={{ strokeWidth: '2.5' }} /> Recommencer
                    </button>
                  </div>

                  {/* Pagination si plusieurs devis */}
                  {results.length > 1 && (
                    <div className="flex items-center justify-between mb-3 shrink-0 rounded-2xl border border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.035] p-2 shadow-[inset_0_1px_0_var(--inner-highlight)]">
                      <button
                        onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                        disabled={currentIndex === 0}
                        className="btn-icon text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-primary">Devis {currentIndex + 1} / {results.length}</p>
                        {currentQuote.title && <p className="text-xs text-secondary truncate max-w-[220px]">{currentQuote.title}</p>}
                      </div>
                      <button
                        onClick={() => setCurrentIndex(i => Math.min(results.length - 1, i + 1))}
                        disabled={currentIndex === results.length - 1}
                        className="btn-icon text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Sections */}
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {(currentQuote.clientName || currentQuote.clientDraft) && (
                      <div className="rounded-2xl border border-[var(--elevation-border)] bg-black/[0.025] dark:bg-white/[0.035] p-4 shadow-[inset_0_1px_0_var(--inner-highlight)]">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-secondary">Client détecté</p>
                        <p className="text-sm font-bold text-primary mt-1">
                          {currentQuote.clientDraft?.company_name || currentQuote.clientName || [currentQuote.clientDraft?.first_name, currentQuote.clientDraft?.last_name].filter(Boolean).join(' ')}
                        </p>
                        {currentQuote.clientDraft?.contact_name && <p className="text-xs text-secondary mt-0.5">Réf. : {currentQuote.clientDraft.contact_name}</p>}
                        {currentQuote.clientDraft?.siret && <p className="text-xs text-secondary mt-0.5">SIRET : {currentQuote.clientDraft.siret}</p>}
                      </div>
                    )}
                    {(currentQuote.quoteWarnings?.length ?? 0) > 0 && (
                      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 space-y-2">
                        {currentQuote.quoteWarnings!.slice(0, 5).map((warning, wi) => (
                          <div key={wi} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{warning}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {currentQuote.sections.map((section, si) => (
                      <div key={si} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden shadow-[inset_0_1px_0_var(--inner-highlight),0_3px_0_0_var(--hard-edge),0_3px_0_1px_var(--shadow-ring),0_6px_12px_var(--shadow-drop)]">
                        <div className="px-4 py-3 bg-black/[0.04] dark:bg-white/[0.06] border-b border-[var(--elevation-border)]">
                          <p className="text-[10px] font-bold text-secondary uppercase tracking-widest">{section.title}</p>
                        </div>
                        <div className="divide-y divide-[var(--elevation-border)]">
                          {section.items.map((item, ii) => (
                            <div key={ii} className="px-4 py-3 flex items-start justify-between gap-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                              <div className="flex-1 min-w-0">
                                {(() => {
                                  const legacy = splitDetails(item.description)
                                  const designation = item.designation?.trim() || legacy.designation
                                  const details = item.details?.trim() || legacy.details
                                  return (
                                    <>
                                      <p className="text-sm font-semibold text-primary leading-snug">{designation}</p>
                                      {details && <p className="text-xs text-secondary mt-1 leading-relaxed whitespace-pre-line">{details}</p>}
                                    </>
                                  )
                                })()}
                                <p className="text-xs text-secondary mt-0.5">
                                  {item.quantity} {item.unit} · TVA {item.vat_rate}%
                                </p>
                                {(item.ai_source || item.ai_confidence != null || (item.ai_warnings?.length ?? 0) > 0) && (
                                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    {item.ai_source && <span className="px-1.5 py-0.5 rounded border border-[var(--elevation-border)] text-[10px] text-secondary">{item.ai_source}</span>}
                                    {item.ai_confidence != null && <span className="px-1.5 py-0.5 rounded border border-[var(--elevation-border)] text-[10px] text-secondary">{Math.round(item.ai_confidence * 100)}% confiance</span>}
                                    {item.ai_warnings?.slice(0, 2).map((warning, wi) => (
                                      <span key={wi} className="px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">{warning}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-semibold text-primary tabular-nums">{fmtPrice(item.unit_price)}</p>
                                <p className="text-xs text-secondary">/unité</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* CTA */}
                  <div className="mt-4 shrink-0 border-t border-[var(--elevation-border)] pt-4">
                    <button
                      onClick={handleCreateInEditor}
                      disabled={isCreating}
                      className="btn-primary w-full h-14 rounded-2xl text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2.5"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Création en cours...
                        </>
                      ) : (
                        <>
                          <FileText className="w-5 h-5" style={{ strokeWidth: '2.5' }} />
                          {results.length > 1 ? `Créer les ${results.length} devis et ouvrir` : 'Ouvrir dans l\'éditeur'}
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                    <p className="text-xs text-secondary text-center mt-2">
                      {results.length > 1
                        ? 'Tous les devis seront créés. Vous serez redirigé vers celui affiché ici.'
                        : 'Le devis sera créé et vous serez redirigé vers l\'éditeur pour finaliser.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
