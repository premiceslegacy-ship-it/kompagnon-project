'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Mic, MicOff, FileText, Upload, X, Loader2,
  CheckCircle2, AlertCircle, RotateCcw, AlertTriangle,
  Trash2, ImageIcon, ChevronDown, ChevronUp, Sparkles,
  ChevronLeft, ChevronRight, Wand2, PenLine,
} from 'lucide-react'
import type {
  CatalogDraftItem,
  CatalogDraftMaterial,
  CatalogDraftLaborRate,
  CatalogDraftPrestationType,
  CatalogDraftSupplier,
  CatalogExtractResult,
} from '@/app/api/ai/catalog-extract/route'
import { bulkCreateFromAI } from '@/lib/data/mutations/catalog-bulk'

type Mode = 'voice' | 'text' | 'pdf' | 'presets'

const ACCEPTED_FILE_TYPES = '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg,image/jpg'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

const KIND_LABELS: Record<string, string> = {
  material: 'Produit / Matière',
  service: 'Service',
  labor_rate: 'Ressource interne',
  prestation_type: 'Modèle de devis',
  supplier: 'Fournisseur',
}

const KIND_COLORS: Record<string, string> = {
  material: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  service: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  labor_rate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  prestation_type: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  supplier: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
}

const DIM_MODE_LABELS: Record<string, string> = {
  none: 'Forfait / Unité',
  linear: 'Linéaire (ml)',
  area: 'Surface (m²)',
  volume: 'Volume (m³)',
}

const LABOR_TYPE_LABELS: Record<string, string> = {
  human: 'Humain',
  machine: 'Machine',
  equipment: 'Équipement',
  subcontractor: 'Sous-traitant',
  other: 'Autre',
}

const DEFAULT_CATEGORIES: Record<string, string[]> = {
  material: ['Fournitures chantier', 'Matière première', 'Plomberie', 'Électricité', 'Consommables', 'Finition'],
  service: ['Pose', 'Main-d\'œuvre', 'Dépannage', 'Maintenance', 'Mise en service', 'Prestation'],
  labor_rate: ['Taux chantier', 'Encadrement', 'Sous-traitance', 'Machine', 'Équipe'],
  prestation_type: ['Installation type', 'Dépannage', 'Entretien', 'Rénovation'],
  supplier: [],
}

function getItemName(item: CatalogDraftItem): string {
  if (item.kind === 'labor_rate') return (item as CatalogDraftLaborRate).designation
  if (item.kind === 'supplier') return (item as CatalogDraftSupplier).name
  if (item.kind === 'material' || item.kind === 'service') return (item as CatalogDraftMaterial).name
  if (item.kind === 'prestation_type') return (item as CatalogDraftPrestationType).name
  return ''
}

function getItemCategory(item: CatalogDraftItem): string | null | undefined {
  if (item.kind === 'supplier') return null
  return (item as CatalogDraftMaterial | CatalogDraftLaborRate | CatalogDraftPrestationType).category
}

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (count: number) => void
}

export default function CatalogAIPanel({ open, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('voice')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [items, setItems] = useState<CatalogDraftItem[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [presetsDescription, setPresetsDescription] = useState('')
  const [presetsCustomMode, setPresetsCustomMode] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMode('voice')
      setText('')
      setFile(null)
      setItems([])
      setError(null)
      setSuccessMsg(null)
      setIsRecording(false)
      setPresetsDescription('')
      setPresetsCustomMode(false)
    }
  }, [open])

  useEffect(() => () => { mediaRecorderRef.current?.stop() }, [])

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
          setError("Impossible de transcrire l'audio.")
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

  async function handleAnalyze() {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setItems([])
    setCurrentPage(0)
    setSuccessMsg(null)
    try {
      let res: Response
      if (mode === 'presets') {
        res = await fetch('/api/ai/catalog-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'presets', description: presetsDescription }),
        })
      } else if (mode === 'pdf' && file) {
        const formData = new FormData()
        formData.append('file', file)
        res = await fetch('/api/ai/catalog-extract', { method: 'POST', body: formData })
      } else {
        res = await fetch('/api/ai/catalog-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      }
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erreur inconnue')
      } else {
        const result = data as CatalogExtractResult
        setItems(result.items ?? [])
        if ((result.items ?? []).length === 0) setError("L'IA n'a détecté aucun élément de catalogue.")
      }
    } catch {
      setError("Impossible de contacter l'IA. Vérifiez votre connexion.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleUpdateItem(idx: number, updated: CatalogDraftItem) {
    setItems(prev => prev.map((item, i) => i === idx ? updated : item))
  }

  async function handleCreateAll() {
    if (items.length === 0) return
    setIsCreating(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await bulkCreateFromAI(items)
      if (result.created > 0) {
        setSuccessMsg(`${result.created} élément${result.created > 1 ? 's' : ''} créé${result.created > 1 ? 's' : ''} avec succès !`)
        onCreated(result.created)
        setItems([])
      }
      if (result.errors.length > 0) {
        setError(`${result.errors.length} erreur(s) : ${result.errors.map(e => e.error).join(', ')}`)
      }
    } catch {
      setError('Erreur lors de la création.')
    } finally {
      setIsCreating(false)
    }
  }

  const canAnalyze = mode === 'presets' ? true : mode === 'pdf' ? !!file : text.trim().length >= 5

  if (!open) return null

  return (
    <div className="fixed bottom-20 right-6 z-50 w-full max-w-[480px] flex flex-col rounded-3xl card shadow-2xl overflow-hidden border border-[var(--elevation-border)] animate-in slide-in-from-bottom-4 fade-in duration-300"
      style={{ maxHeight: 'calc(100vh - 120px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--elevation-border)] flex-shrink-0 bg-gradient-to-r from-violet-500/10 to-indigo-500/10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="font-bold text-primary text-sm">Assistant catalogue</p>
            <p className="text-xs text-secondary">Dictez, écrivez ou importez un document</p>
          </div>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Zone de saisie */}
        {items.length === 0 && !successMsg && (
          <div className="p-4 flex flex-col gap-3">

            {/* Tabs mode */}
            <div className="flex gap-1 p-1 rounded-xl bg-black/5 dark:bg-white/5">
              {([
                { id: 'voice' as const, label: 'Vocal', icon: Mic },
                { id: 'text' as const, label: 'Texte', icon: FileText },
                { id: 'pdf' as const, label: 'Document', icon: ImageIcon },
                { id: 'presets' as const, label: 'Gammes IA', icon: Wand2 },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setMode(id); setText(''); setFile(null); setError(null); setPresetsCustomMode(false) }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === id ? 'bg-surface text-primary shadow-sm dark:bg-white/10' : 'text-secondary hover:text-primary'}`}
                >
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>

            {/* Vocal */}
            {mode === 'voice' && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-secondary">Décrivez vos produits, matières, services, ressources ou fournisseurs. L&apos;IA les classifie automatiquement dans le bon onglet.</p>
                <div className="flex flex-col items-center gap-3 py-4">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isTranscribing}
                    className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700'} disabled:opacity-50`}
                  >
                    {isTranscribing ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : isRecording ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
                  </button>
                  <p className="text-xs text-secondary text-center">
                    {isTranscribing ? 'Transcription…' : isRecording ? 'Enregistrement… cliquez pour arrêter' : 'Cliquez pour parler'}
                  </p>
                </div>
                {text && (
                  <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--elevation-border)]">
                    <p className="text-xs text-secondary font-medium mb-1">Transcription</p>
                    <p className="text-xs text-primary leading-relaxed">{text}</p>
                  </div>
                )}
              </div>
            )}

            {/* Texte */}
            {mode === 'text' && (
              <div className="flex flex-col gap-2">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Ex: tôle acier S235 2mm plaque 1m×1m 25,50€ achat marge 40%, service découpe laser au ml à 8€, fournisseur ArcelorMittal contact Paul 0612345678…"
                  rows={8}
                  className="min-h-[11rem] max-h-[22rem] overflow-y-auto p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-xs resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                />
              </div>
            )}

            {/* Gammes IA */}
            {mode === 'presets' && (
              <div className="flex flex-col gap-3">
                {!presetsCustomMode ? (
                  <>
                    <p className="text-xs text-secondary">
                      L&apos;IA génère des modèles de devis types adaptés à votre métier. Ajoutez une description optionnelle pour affiner les suggestions.
                    </p>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-secondary uppercase tracking-wide">Description (optionnelle)</label>
                      <textarea
                        value={presetsDescription}
                        onChange={e => setPresetsDescription(e.target.value)}
                        placeholder="Ex: on fait surtout des rénovations de salles de bain et des dépannages plomberie urgents…"
                        rows={3}
                        className="p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                      />
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
                      <Wand2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                      <p className="text-xs text-secondary">L&apos;IA propose 5 à 8 gammes. Vous les passez en revue et supprimez ce qui ne convient pas.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPresetsCustomMode(false)}
                        className="flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" /> Retour aux suggestions automatiques
                      </button>
                    </div>
                    <p className="text-xs text-secondary">Décrivez précisément le modèle de devis que vous souhaitez créer.</p>
                    <textarea
                      value={presetsDescription}
                      onChange={e => setPresetsDescription(e.target.value)}
                      placeholder="Ex: je veux un modèle de devis pour la pose d&apos;un tableau électrique 13 modules avec remplacement des disjoncteurs, environ 4h de main-d&apos;oeuvre, TVA 10%…"
                      rows={6}
                      className="p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                    />
                  </>
                )}
              </div>
            )}

            {/* Document */}
            {mode === 'pdf' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-secondary">PDF, PNG ou JPEG — cahier des charges, catalogue fournisseur, modèle papier scanné…</p>
                {!file ? (
                  <div
                    className="border-2 border-dashed border-[var(--elevation-border)] rounded-xl flex flex-col items-center justify-center gap-3 py-8 text-secondary hover:border-violet-400/50 hover:bg-violet-500/5 transition-all cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const dropped = e.dataTransfer.files[0]
                      if (dropped && ACCEPTED_MIME_TYPES.has(dropped.type)) { setFile(dropped); setError(null) }
                      else setError('Formats acceptés : PDF, PNG, JPEG')
                    }}
                  >
                    <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setError(null) } }} />
                    <Upload className="w-5 h-5 text-violet-400" />
                    <p className="text-xs text-center"><span className="font-semibold text-primary">Glissez un document</span><br />ou cliquez pour sélectionner</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--elevation-border)]">
                    <FileText className="w-5 h-5 text-violet-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-primary truncate">{file.name}</p>
                      <p className="text-xs text-secondary">{(file.size / 1024).toFixed(0)} Ko</p>
                    </div>
                    <button onClick={() => setFile(null)} className="text-secondary hover:text-primary transition-colors"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || isAnalyzing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-bold text-sm hover:from-violet-600 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isAnalyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" />{mode === 'presets' ? 'Génération…' : 'Analyse…'}</>
                : mode === 'presets'
                  ? <><Wand2 className="w-4 h-4" />{presetsCustomMode ? 'Générer ce modèle' : 'Générer les gammes'}</>
                  : <><Sparkles className="w-4 h-4" />Analyser</>
              }
            </button>
          </div>
        )}

        {/* Succès */}
        {successMsg && (
          <div className="p-6 flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <p className="font-bold text-primary text-sm text-center">{successMsg}</p>
            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 w-full">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
            <button onClick={onClose} className="px-5 py-2 rounded-full bg-accent text-black font-bold text-sm hover:scale-105 transition-all">Fermer</button>
          </div>
        )}

        {/* Revue des items — pagination 1 par 1 */}
        {items.length > 0 && !successMsg && (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-primary text-sm">{items.length} modèle{items.length > 1 ? 's' : ''} {mode === 'presets' ? 'généré' : 'détecté'}{items.length > 1 ? 's' : ''}</span>
              <button onClick={() => { setItems([]); setCurrentPage(0); setError(null) }} className="flex items-center gap-1 text-xs text-secondary hover:text-primary transition-colors">
                <RotateCcw className="w-3 h-3" /> Recommencer
              </button>
            </div>

            {mode === 'presets' && (
              <button
                onClick={() => {
                  setItems([])
                  setCurrentPage(0)
                  setError(null)
                  setPresetsCustomMode(true)
                  setPresetsDescription('')
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[var(--elevation-border)] text-xs text-secondary hover:text-primary hover:border-violet-400/40 hover:bg-violet-500/5 transition-all"
              >
                <PenLine className="w-3.5 h-3.5" />
                Ces gammes ne me conviennent pas, décrire un modèle précis
              </button>
            )}

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <ItemReviewCard
              key={currentPage}
              item={items[currentPage]}
              onRemove={() => {
                const next = items.filter((_, i) => i !== currentPage)
                setItems(next)
                setCurrentPage(p => Math.min(p, next.length - 1))
              }}
              onChange={updated => handleUpdateItem(currentPage, updated)}
            />

            {/* Navigation page */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-secondary font-medium">
                {currentPage + 1} / {items.length}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(items.length - 1, p + 1))}
                disabled={currentPage === items.length - 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {items.length > 0 && !successMsg && (
        <div className="px-4 pb-4 pt-3 border-t border-[var(--elevation-border)] flex-shrink-0">
          <button
            onClick={handleCreateAll}
            disabled={isCreating || items.length === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-bold text-sm hover:from-violet-600 hover:to-indigo-700 disabled:opacity-60 transition-colors"
          >
            {isCreating
              ? <><Loader2 className="w-4 h-4 animate-spin" />Création en cours…</>
              : <><CheckCircle2 className="w-4 h-4" />Tout créer ({items.length} élément{items.length > 1 ? 's' : ''})</>
            }
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Carte de revue détaillée par item ────────────────────────────────────────

function ItemReviewCard({
  item,
  onRemove,
  onChange,
}: {
  item: CatalogDraftItem
  onRemove: () => void
  onChange: (updated: CatalogDraftItem) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasLow = Object.values(item.confidence ?? {}).some(v => v === 'low')

  function patch(field: string, value: unknown) {
    onChange({ ...item, [field]: value } as CatalogDraftItem)
  }

  function patchNested(parentField: string, idx: number, field: string, value: unknown) {
    const arr = [...(((item as unknown) as Record<string, unknown[]>)[parentField] ?? [])] as Record<string, unknown>[]
    arr[idx] = { ...arr[idx], [field]: value }
    onChange({ ...item, [parentField]: arr } as CatalogDraftItem)
  }

  const kindColor = KIND_COLORS[item.kind] ?? ''

  return (
    <div className={`rounded-2xl border overflow-hidden ${kindColor}`}>
      {/* Card header */}
      <div className="px-3 py-2.5 flex items-start gap-2">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${kindColor} shrink-0`}>
              {KIND_LABELS[item.kind] ?? item.kind}
            </span>
            {hasLow && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                <AlertTriangle className="w-2.5 h-2.5" />À vérifier
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-primary truncate leading-tight">{getItemName(item)}</p>
          {getItemCategory(item) && (
            <p className="text-[10px] text-secondary truncate">{getItemCategory(item)}</p>
          )}
        </div>
        <div className="flex items-center gap-0 shrink-0">
          <button onClick={() => setExpanded(v => !v)} className="text-secondary hover:text-primary transition-colors p-1">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onRemove} className="text-secondary hover:text-red-500 transition-colors p-1">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Fields */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-[var(--elevation-border)] pt-2.5 bg-surface dark:bg-black/20 flex flex-col gap-2">
          {(item.kind === 'material' || item.kind === 'service') && (
            <MaterialFields item={item as CatalogDraftMaterial} patch={patch} />
          )}
          {item.kind === 'labor_rate' && (
            <LaborRateFields item={item as CatalogDraftLaborRate} patch={patch} />
          )}
          {item.kind === 'prestation_type' && (
            <PrestationTypeFields item={item as CatalogDraftPrestationType} patch={patch} patchNested={patchNested} />
          )}
          {item.kind === 'supplier' && (
            <SupplierFields item={item as CatalogDraftSupplier} patch={patch} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers champs ────────────────────────────────────────────────────────────

const fieldCls = 'w-full px-2.5 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-xs focus:outline-none focus:ring-1 focus:ring-violet-400/50'
const lowFieldCls = 'w-full px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-400/40 text-primary text-xs focus:outline-none focus:ring-1 focus:ring-amber-400/50'
const labelCls = 'text-[10px] font-semibold text-secondary uppercase tracking-wide'

function isLow(item: CatalogDraftItem, field: string) {
  return (item.confidence?.[field] ?? 'high') === 'low'
}

function Field({ label, low, children }: { label: string; low?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className={`${labelCls}${low ? ' text-amber-600 dark:text-amber-400' : ''}`}>
        {label}{low && <span className="ml-1 text-amber-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function MaterialFields({ item, patch }: { item: CatalogDraftMaterial; patch: (f: string, v: unknown) => void }) {
  const computedSale = item.purchase_price != null && item.margin_rate != null
    ? (item.purchase_price * (1 + item.margin_rate / 100)).toFixed(2)
    : item.sale_price != null ? String(item.sale_price) : ''

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Désignation" low={isLow(item, 'name')}>
          <input value={item.name} onChange={e => patch('name', e.target.value)} className={isLow(item, 'name') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Référence">
          <input value={item.reference ?? ''} onChange={e => patch('reference', e.target.value || null)} className={fieldCls} placeholder="auto" />
        </Field>
        <Field label="Catégorie" low={isLow(item, 'category')}>
          <input
            list={`cat-list-${item.kind}`}
            value={item.category ?? ''}
            onChange={e => patch('category', e.target.value || null)}
            className={isLow(item, 'category') ? lowFieldCls : fieldCls}
            placeholder="Ex: Fournitures chantier"
          />
          <datalist id={`cat-list-${item.kind}`}>
            {(DEFAULT_CATEGORIES[item.kind] ?? []).map(cat => <option key={cat} value={cat} />)}
          </datalist>
        </Field>
        <Field label="Unité" low={isLow(item, 'unit')}>
          <input value={item.unit} onChange={e => patch('unit', e.target.value)} className={isLow(item, 'unit') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Coût achat HT (€)" low={isLow(item, 'purchase_price')}>
          <input
            type="number" step="0.01"
            value={item.purchase_price ?? ''}
            onChange={e => patch('purchase_price', parseFloat(e.target.value) || null)}
            className={isLow(item, 'purchase_price') ? lowFieldCls : fieldCls}
            placeholder="0.00"
          />
        </Field>
        <Field label="Marge (%)" low={isLow(item, 'margin_rate')}>
          <input
            type="number" step="1"
            value={item.margin_rate ?? ''}
            onChange={e => patch('margin_rate', parseFloat(e.target.value) || 0)}
            className={isLow(item, 'margin_rate') ? lowFieldCls : fieldCls}
            placeholder="0"
          />
        </Field>
        <Field label="Prix vente HT (€)" low={isLow(item, 'sale_price')}>
          <input
            type="number" step="0.01"
            value={computedSale}
            onChange={e => patch('sale_price', parseFloat(e.target.value) || null)}
            className={isLow(item, 'sale_price') ? lowFieldCls : fieldCls}
            placeholder="calculé auto"
          />
        </Field>
        <Field label="TVA (%)" low={isLow(item, 'vat_rate')}>
          <select value={item.vat_rate} onChange={e => patch('vat_rate', parseFloat(e.target.value))} className={`${isLow(item, 'vat_rate') ? lowFieldCls : fieldCls} appearance-none`}>
            {[0, 5.5, 10, 20].map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
      </div>
      <Field label="Mode tarification" low={isLow(item, 'dimension_pricing_mode')}>
        <select value={item.dimension_pricing_mode ?? 'none'} onChange={e => patch('dimension_pricing_mode', e.target.value)} className={`${isLow(item, 'dimension_pricing_mode') ? lowFieldCls : fieldCls} appearance-none`}>
          {Object.entries(DIM_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {item.supplier_name != null && (
        <Field label="Fournisseur">
          <input value={item.supplier_name} onChange={e => patch('supplier_name', e.target.value || null)} className={fieldCls} />
        </Field>
      )}
    </>
  )
}

function LaborRateFields({ item, patch }: { item: CatalogDraftLaborRate; patch: (f: string, v: unknown) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Désignation" low={isLow(item, 'designation')}>
          <input value={item.designation} onChange={e => patch('designation', e.target.value)} className={isLow(item, 'designation') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Type" low={isLow(item, 'type')}>
          <select value={item.type} onChange={e => patch('type', e.target.value)} className={`${isLow(item, 'type') ? lowFieldCls : fieldCls} appearance-none`}>
            {Object.entries(LABOR_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Catégorie">
          <input
            list="cat-list-labor_rate"
            value={item.category ?? ''}
            onChange={e => patch('category', e.target.value || null)}
            className={fieldCls}
            placeholder="Ex: Taux chantier"
          />
          <datalist id="cat-list-labor_rate">
            {DEFAULT_CATEGORIES.labor_rate.map(cat => <option key={cat} value={cat} />)}
          </datalist>
        </Field>
        <Field label="Unité" low={isLow(item, 'unit')}>
          <input value={item.unit} onChange={e => patch('unit', e.target.value)} className={isLow(item, 'unit') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Coût interne (€)" low={isLow(item, 'cost_rate')}>
          <input type="number" step="0.01" value={item.cost_rate ?? ''} onChange={e => patch('cost_rate', parseFloat(e.target.value) || null)} className={isLow(item, 'cost_rate') ? lowFieldCls : fieldCls} placeholder="0.00" />
        </Field>
        <Field label="Taux facturation (€)" low={isLow(item, 'rate')}>
          <input type="number" step="0.01" value={item.rate ?? ''} onChange={e => patch('rate', parseFloat(e.target.value) || 0)} className={isLow(item, 'rate') ? lowFieldCls : fieldCls} placeholder="0.00" />
        </Field>
        <Field label="TVA (%)" low={isLow(item, 'vat_rate')}>
          <select value={item.vat_rate} onChange={e => patch('vat_rate', parseFloat(e.target.value))} className={`${isLow(item, 'vat_rate') ? lowFieldCls : fieldCls} appearance-none`}>
            {[0, 5.5, 10, 20].map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
      </div>
    </>
  )
}

function PrestationTypeFields({ item, patch, patchNested }: {
  item: CatalogDraftPrestationType
  patch: (f: string, v: unknown) => void
  patchNested: (parent: string, idx: number, field: string, value: unknown) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nom" low={isLow(item, 'name')}>
          <input value={item.name} onChange={e => patch('name', e.target.value)} className={isLow(item, 'name') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Catégorie">
          <input value={item.category ?? ''} onChange={e => patch('category', e.target.value || null)} className={fieldCls} />
        </Field>
        <Field label="Unité" low={isLow(item, 'unit')}>
          <input value={item.unit} onChange={e => patch('unit', e.target.value)} className={isLow(item, 'unit') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="TVA (%)" low={isLow(item, 'vat_rate')}>
          <select value={item.vat_rate} onChange={e => patch('vat_rate', parseFloat(e.target.value))} className={`${isLow(item, 'vat_rate') ? lowFieldCls : fieldCls} appearance-none`}>
            {[0, 5.5, 10, 20].map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
        <Field label="Prix HT (€)" low={isLow(item, 'base_price_ht')}>
          <input type="number" step="0.01" value={item.base_price_ht ?? ''} onChange={e => patch('base_price_ht', parseFloat(e.target.value) || 0)} className={isLow(item, 'base_price_ht') ? lowFieldCls : fieldCls} placeholder="0.00" />
        </Field>
        <Field label="Coût HT (€)" low={isLow(item, 'base_cost_ht')}>
          <input type="number" step="0.01" value={item.base_cost_ht ?? ''} onChange={e => patch('base_cost_ht', parseFloat(e.target.value) || 0)} className={isLow(item, 'base_cost_ht') ? lowFieldCls : fieldCls} placeholder="0.00" />
        </Field>
      </div>
      {item.description !== undefined && (
        <Field label="Description">
          <input value={item.description ?? ''} onChange={e => patch('description', e.target.value || null)} className={fieldCls} />
        </Field>
      )}
      {item.lines && item.lines.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className={labelCls}>{item.lines.length} ligne{item.lines.length > 1 ? 's' : ''}</p>
          {item.lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[1fr_60px_60px_80px] gap-1">
              <input value={line.designation} onChange={e => patchNested('lines', i, 'designation', e.target.value)} className={fieldCls} placeholder="Désignation" />
              <input type="number" step="0.01" value={line.quantity} onChange={e => patchNested('lines', i, 'quantity', parseFloat(e.target.value) || 1)} className={fieldCls} placeholder="Qté" />
              <input value={line.unit} onChange={e => patchNested('lines', i, 'unit', e.target.value)} className={fieldCls} placeholder="Unité" />
              <input type="number" step="0.01" value={line.unit_price_ht ?? ''} onChange={e => patchNested('lines', i, 'unit_price_ht', parseFloat(e.target.value) || null)} className={fieldCls} placeholder="Prix €" />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function SupplierFields({ item, patch }: { item: CatalogDraftSupplier; patch: (f: string, v: unknown) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nom" low={isLow(item, 'name')}>
          <input value={item.name} onChange={e => patch('name', e.target.value)} className={isLow(item, 'name') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Contact" low={isLow(item, 'contact_name')}>
          <input value={item.contact_name ?? ''} onChange={e => patch('contact_name', e.target.value || null)} className={isLow(item, 'contact_name') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Email" low={isLow(item, 'email')}>
          <input type="email" value={item.email ?? ''} onChange={e => patch('email', e.target.value || null)} className={isLow(item, 'email') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Téléphone" low={isLow(item, 'phone')}>
          <input value={item.phone ?? ''} onChange={e => patch('phone', e.target.value || null)} className={isLow(item, 'phone') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="SIRET" low={isLow(item, 'siret')}>
          <input value={item.siret ?? ''} onChange={e => patch('siret', e.target.value || null)} className={isLow(item, 'siret') ? lowFieldCls : fieldCls} />
        </Field>
        <Field label="Conditions paiement" low={isLow(item, 'payment_terms')}>
          <input value={item.payment_terms ?? ''} onChange={e => patch('payment_terms', e.target.value || null)} className={isLow(item, 'payment_terms') ? lowFieldCls : fieldCls} />
        </Field>
      </div>
      <Field label="Adresse">
        <input value={item.address ?? ''} onChange={e => patch('address', e.target.value || null)} className={fieldCls} />
      </Field>
    </>
  )
}
