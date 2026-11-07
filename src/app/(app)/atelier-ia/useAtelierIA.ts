'use client'
// @atelier-migrated
// Logique de l'éditeur : états, calculs et envoi. L'affichage vit dans AtelierIAClient.tsx.

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { createQuoteFromAIResult } from '@/lib/data/mutations/quotes'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import { DEFAULT_MEASUREMENT_SETTINGS, MEASUREMENT_TRADE_LABELS, PLAN_MEASUREMENT_RULES_VERSION, buildMeasurementItems, evaluateMeasurementFormula, hasBlockingMeasurementIssues, type PlanMeasurementItem, type PlanMeasurementResult, type PlanMeasurementSettings, type PlanMeasurementTrade, type PlanProjectType, type PlanWorkScope } from '@/lib/plan-measurement'
import { markPlanMeasurementConverted, savePlanMeasurementDraft } from '@/lib/data/mutations/plan-measurements'

import { Mode, formulaVariablesForItem, measurementToQuote } from './atelierIAModel'

export type AtelierIAProps = { initialMeasurementTrades: PlanMeasurementTrade[] }

export function useAtelierIA({ initialMeasurementTrades }: { initialMeasurementTrades: PlanMeasurementTrade[] }) {

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
  const [measurementSettings, setMeasurementSettings] = useState<PlanMeasurementSettings>(DEFAULT_MEASUREMENT_SETTINGS)
  const [projectType, setProjectType] = useState<PlanProjectType>('renovation')
  const [selectedTrades, setSelectedTrades] = useState<PlanMeasurementTrade[]>(initialMeasurementTrades)
  const [workScopes, setWorkScopes] = useState<Partial<Record<PlanMeasurementTrade, PlanWorkScope>>>(() => Object.fromEntries(initialMeasurementTrades.map(trade => [trade, 'replace'])))
  const [measurementTradeFilter, setMeasurementTradeFilter] = useState<PlanMeasurementTrade | 'all'>('all')
  const [measurementRoomFilter, setMeasurementRoomFilter] = useState<string>('all')
  const [draftStatus, setDraftStatus] = useState<string | null>(null)
  const [formulaError, setFormulaError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [creditsError, setCreditsError] = useState(false)
  const [briefBanner, setBriefBanner] = useState<string | null>(null)
  const [documentChoiceOpen, setDocumentChoiceOpen] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

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
        if (mode === 'measure') {
          formData.append('projectType', projectType)
          formData.append('selectedTrades', JSON.stringify(selectedTrades))
          formData.append('workScopes', JSON.stringify(workScopes))
          formData.append('settings', JSON.stringify(measurementSettings))
        }
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
          setMeasurementSettings(nextMeasurement.settings)
          setMeasurement(nextMeasurement)
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
    if (hasBlockingMeasurementIssues(measurement)) {
      setError('Confirmez la calibration et validez ou excluez les lignes critiques avant de créer le devis.')
      return
    }
    setIsCreating(true)
    setError(null)

    try {
      const quoteRes = await createQuoteFromAIResult(measurementToQuote(measurement))
      if (quoteRes.error || !quoteRes.quoteId) {
        setError(quoteRes.error ?? 'Impossible de créer le devis')
        setIsCreating(false)
        return
      }
      if (measurement.id) await markPlanMeasurementConverted(measurement.id, quoteRes.quoteId)
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
    setDraftStatus(null)
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

  function toggleMeasurementTrade(trade: PlanMeasurementTrade) {
    setSelectedTrades(current => current.includes(trade) ? current.filter(value => value !== trade) : [...current, trade])
    setWorkScopes(current => ({ ...current, [trade]: current[trade] ?? (projectType === 'new' ? 'create' : 'replace') }))
  }

  function changeProjectType(next: PlanProjectType) {
    setProjectType(next)
    setWorkScopes(current => Object.fromEntries(selectedTrades.map(trade => [trade, current[trade] ?? (next === 'new' ? 'create' : 'replace')])))
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

  function removeMeasurementItem(index: number) {
    setMeasurement(current => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)
  }

  function addMeasurementItem() {
    const tradeId = measurementTradeFilter === 'all' ? selectedTrades[0] ?? 'placo_isolation' : measurementTradeFilter
    setMeasurement(current => current ? {
      ...current,
      items: [...current.items, {
        id: `manual-${crypto.randomUUID()}`, roomId: null, roomName: 'Général', tradeId,
        trade: MEASUREMENT_TRADE_LABELS[tradeId], designation: 'Nouvelle ligne', quantity: 1, unit: 'u',
        dimension_pricing_mode: 'none', confidence: 1, assumptions: ['Ligne ajoutée manuellement.'], warnings: [],
        formula: 'quantity', formulaVariables: { quantity: 1 }, evidence: [{ label: 'Saisie artisan', source: 'user_input' }],
        sourceKind: 'measured', validationStatus: 'pending', critical: false, rulesVersion: PLAN_MEASUREMENT_RULES_VERSION,
      }],
    } : current)
  }

  function updateMeasurementRoom(roomIndex: number, field: 'area_m2' | 'perimeter_m' | 'height_m', raw: string) {
    setMeasurement(current => {
      if (!current) return current
      const value = raw === '' ? null : Math.max(0, Number(raw) || 0)
      const rooms = current.rooms.map((room, index) => index === roomIndex ? {
        ...room, [field]: value, confidence: 1,
        evidence: [...room.evidence.filter(evidence => evidence.source !== 'user_input'), { label: `${field} corrigé`, source: 'user_input' as const, value: value == null ? null : String(value) }],
      } : room)
      const regenerated = buildMeasurementItems({ rooms, openings: current.openings, scope: current.scope, settings: measurementSettings })
      const previousById = new Map(current.items.map(item => [item.id, item]))
      const manualItems = current.items.filter(item => item.id.startsWith('manual-'))
      return {
        ...current, rooms,
        items: [
          ...regenerated.map(item => ({ ...item, validationStatus: previousById.get(item.id)?.validationStatus ?? item.validationStatus })),
          ...manualItems,
        ],
      }
    })
  }

  async function saveMeasurementDraft() {
    if (!measurement) return
    if (JSON.stringify(measurement.settings) !== JSON.stringify(measurementSettings)) {
      setDraftStatus('Recalculez les lignes avant d’enregistrer')
      return
    }
    setDraftStatus('Enregistrement…')
    const next = { ...measurement, settings: measurementSettings }
    const result = await savePlanMeasurementDraft(next)
    setDraftStatus(result.error ? `Erreur : ${result.error}` : 'Brouillon enregistré')
  }

  async function resumeLatestMeasurement() {
    setError(null)
    setDraftStatus('Chargement…')
    try {
      const response = await fetch('/api/ai/measure-plan')
      const data = await response.json()
      if (!response.ok || !data.measurement) {
        setDraftStatus('Aucun brouillon disponible')
        return
      }
      const latest = data.measurement as PlanMeasurementResult
      setMeasurement(latest)
      setMeasurementSettings(latest.settings)
      setProjectType(latest.scope.projectType)
      setSelectedTrades(latest.scope.selectedTrades)
      setWorkScopes(latest.scope.workScopes)
      setDraftStatus('Brouillon repris')
    } catch {
      setDraftStatus('Impossible de charger le brouillon')
    }
  }

  function recalculateMeasurementItem(index: number) {
    setMeasurement(current => {
      if (!current) return current
      const item = current.items[index]
      if (!item) return current
      try {
        const formula = item.formula.trim()
        const formulaVariables = formulaVariablesForItem(item, measurementSettings)
        const quantity = evaluateMeasurementFormula(formula, formulaVariables)
        setFormulaError(null)
        return {
          ...current,
          settings: measurementSettings,
          items: current.items.map((row, i) => i === index ? { ...row, formula, formulaVariables, quantity } : row),
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
          const formula = item.formula.trim()
          const formulaVariables = formulaVariablesForItem(item, measurementSettings)
          return {
            ...item,
            formula,
            formulaVariables,
            quantity: evaluateMeasurementFormula(formula, formulaVariables),
          }
        })
        setFormulaError(null)
        return { ...current, settings: measurementSettings, items }
      } catch (err) {
        setFormulaError(err instanceof Error ? err.message : 'Une formule est invalide')
        return current
      }
    })
  }

  const currentQuote = results[currentIndex] ?? null
  const canAnalyze = mode === 'pdf' ? !!file : mode === 'measure' ? Boolean(file && selectedTrades.length) : text.trim().length >= 5
  const totalItems = currentQuote?.sections.reduce((s: number, sec: AIQuoteResult['sections'][0]) => s + sec.items.length, 0) ?? 0
  const documentModeActive = mode === 'pdf' || mode === 'measure'
  const filteredMeasurementItems = measurement?.items.filter(item =>
    (measurementTradeFilter === 'all' || item.tradeId === measurementTradeFilter)
    && (measurementRoomFilter === 'all' || item.roomId === measurementRoomFilter),
  ) ?? []
  const measurementSettingsDirty = measurement ? JSON.stringify(measurement.settings) !== JSON.stringify(measurementSettings) : false
  const blockingMeasurementIssues = measurement ? hasBlockingMeasurementIssues(measurement) || measurementSettingsDirty : false

  return {
    initialMeasurementTrades,
    router,
    mode,
    setMode,
    text,
    setText,
    file,
    setFile,
    pdfDescription,
    setPdfDescription,
    isRecording,
    setIsRecording,
    isTranscribing,
    setIsTranscribing,
    isAnalyzing,
    setIsAnalyzing,
    analyzeStage,
    setAnalyzeStage,
    isCreating,
    setIsCreating,
    results,
    setResults,
    measurement,
    setMeasurement,
    measurementSettings,
    setMeasurementSettings,
    projectType,
    setProjectType,
    selectedTrades,
    setSelectedTrades,
    workScopes,
    setWorkScopes,
    measurementTradeFilter,
    setMeasurementTradeFilter,
    measurementRoomFilter,
    setMeasurementRoomFilter,
    draftStatus,
    setDraftStatus,
    formulaError,
    setFormulaError,
    currentIndex,
    setCurrentIndex,
    error,
    setError,
    creditsError,
    setCreditsError,
    briefBanner,
    setBriefBanner,
    documentChoiceOpen,
    setDocumentChoiceOpen,
    startRecording,
    stopRecording,
    handleAnalyze,
    handleCreateInEditor,
    handleCreateMeasurementInEditor,
    handleReset,
    handleModeChange,
    handleDocumentModeClick,
    toggleMeasurementTrade,
    changeProjectType,
    updateMeasurementItem,
    removeMeasurementItem,
    addMeasurementItem,
    updateMeasurementRoom,
    saveMeasurementDraft,
    resumeLatestMeasurement,
    recalculateMeasurementItem,
    recalculateAllMeasurementItems,
    currentQuote,
    canAnalyze,
    totalItems,
    documentModeActive,
    filteredMeasurementItems,
    measurementSettingsDirty,
    blockingMeasurementIssues,
  }
}

export type AtelierIA = ReturnType<typeof useAtelierIA>
