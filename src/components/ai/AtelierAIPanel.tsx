'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  X, Mic, MicOff, FileText, Bot, Loader2, Upload,
  ChevronRight, ChevronLeft, Plus, CheckCircle2, AlertCircle, RotateCcw, ImageIcon,
} from 'lucide-react'
import type { AIQuoteResult, AIQuoteSection, AIQuoteItem } from '@/app/api/ai/analyze-quote/route'
import { AI_NAME } from '@/lib/brand'

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = 'voice' | 'text' | 'pdf'

type Props = {
  onImport: (result: AIQuoteResult) => void
  onClose: () => void
  voiceInputEnabled?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
const BASE_MODES: Array<{ id: Mode; label: string; icon: typeof Mic }> = [
  { id: 'text', label: 'Texte', icon: FileText },
  { id: 'pdf', label: 'PDF', icon: Upload },
]

function isAccepted(f: File) {
  return ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext))
}

function fileIcon(f: File) {
  return f.type.startsWith('image/') || f.name.match(/\.(jpg|jpeg|png|webp)$/i) ? 'image' : 'pdf'
}

const fmtPrice = (n: number) =>
  n > 0
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
    : '-'

// ─── Component ───────────────────────────────────────────────────────────────

export default function AtelierAIPanel({ onImport, onClose, voiceInputEnabled = true }: Props) {
  const [mode, setMode] = useState<Mode>(voiceInputEnabled ? 'voice' : 'text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pdfDescription, setPdfDescription] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [results, setResults] = useState<AIQuoteResult[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [importedIndexes, setImportedIndexes] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── MediaRecorder → Mistral transcription ────────────────────────────────

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

  // ─── AI Analysis ──────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setResults([])
    setCurrentIndex(0)
    setImportedIndexes(new Set())

    try {
      let res: Response
      if (mode === 'pdf' && file) {
        const formData = new FormData()
        formData.append('file', file)
        if (pdfDescription.trim()) formData.append('description', pdfDescription.trim())
        res = await fetch('/api/ai/analyze-quote', { method: 'POST', body: formData })
      } else {
        res = await fetch('/api/ai/analyze-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      }
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erreur inconnue')
      else setResults((data as { quotes: AIQuoteResult[] }).quotes ?? [])
    } catch {
      setError('Impossible de contacter l\'IA. Vérifiez votre connexion.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleImport(index: number) {
    const q = results[index]
    if (!q) return
    onImport(q)
    const nextImported = new Set(importedIndexes).add(index)
    setImportedIndexes(nextImported)
    const nextIndex = results.findIndex((_, i) => i !== index && !nextImported.has(i))
    if (nextIndex >= 0) setCurrentIndex(nextIndex)
  }

  function handleReset() {
    setText('')
    setFile(null)
    setPdfDescription('')
    setResults([])
    setCurrentIndex(0)
    setImportedIndexes(new Set())
    setError(null)
  }

  function handleModeChange(m: Mode) {
    if (m === 'voice' && !voiceInputEnabled) return
    if (isRecording) stopRecording()
    setMode(m)
    handleReset()
  }

  const currentQuote = results[currentIndex] ?? null
  const canAnalyze = mode === 'pdf' ? !!file : text.trim().length >= 5
  const totalItems = currentQuote?.sections.reduce((sum: number, s: AIQuoteSection) => sum + s.items.length, 0) ?? 0
  const availableModes: Array<{ id: Mode; label: string; icon: typeof Mic }> = voiceInputEnabled
    ? [{ id: 'voice', label: 'Vocal', icon: Mic }, ...BASE_MODES]
    : BASE_MODES

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[110] flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-lg bg-surface border-l border-[var(--elevation-border)] flex flex-col shadow-2xl dark:bg-[#0d0d0d]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--elevation-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-primary leading-none">{AI_NAME}</h2>
              <p className="text-xs text-secondary mt-0.5">Génération assistée de devis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode switcher */}
        <div className="px-6 pt-4">
          <div className="flex gap-1 p-1 rounded-xl bg-black/5 dark:bg-white/5">
            {availableModes.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleModeChange(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === id
                    ? 'bg-surface text-primary shadow-sm dark:bg-white/10'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Input zone */}
          {!currentQuote && (
            <div className="space-y-3">

              {/* Voice mode */}
              {mode === 'voice' && (
                <>
                  <p className="text-xs text-secondary">Décrivez les travaux à voix haute. L'IA structurera automatiquement votre devis.</p>
                  <div className="flex flex-col items-center gap-4 py-6">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                        isRecording
                          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                          : 'bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700'
                      }`}
                    >
                      {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
                    </button>
                    <p className="text-sm text-secondary">
                      {isRecording ? 'En cours d\'enregistrement... (cliquez pour arrêter)' : isTranscribing ? 'Transcription en cours...' : 'Cliquez pour parler'}
                    </p>
                  </div>
                  {isTranscribing && (
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Transcription Mistral en cours...
                    </div>
                  )}
                  {text && (
                    <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--elevation-border)]">
                      <p className="text-xs text-secondary mb-1 font-medium">Transcription</p>
                      <p className="text-sm text-primary leading-relaxed">{text}</p>
                    </div>
                  )}
                </>
              )}

              {/* Text mode */}
              {mode === 'text' && (
                <>
                  <p className="text-xs text-secondary">Décrivez librement les travaux à réaliser.</p>
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Ex: Rénovation d'une salle de bain de 8m2 : dépose ancien carrelage, pose nouveau carrelage 60×60, remplacement baignoire par douche italienne, changement lavabo..."
                    rows={10}
                    className="w-full min-h-[14rem] max-h-[28rem] overflow-y-auto p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                  />
                </>
              )}

              {/* PDF / Image mode */}
              {mode === 'pdf' && (
                <>
                  <p className="text-xs text-secondary">Importez un PDF ou une image (photo, plan scanné). L'IA extraira les postes directement.</p>
                  {!file ? (
                    <div
                      className="border-2 border-dashed border-[var(--elevation-border)] rounded-xl py-10 flex flex-col items-center gap-3 text-secondary hover:border-violet-400/50 hover:bg-violet-500/5 transition-all cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        const dropped = e.dataTransfer.files[0]
                        if (!dropped) return
                        if (isAccepted(dropped)) { setFile(dropped); setError(null) }
                        else setError('Formats acceptés : PDF, JPEG, PNG, WEBP')
                      }}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          if (isAccepted(f)) { setFile(f); setError(null) }
                          else setError('Formats acceptés : PDF, JPEG, PNG, WEBP')
                          e.target.value = ''
                        }}
                      />
                      <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-violet-500" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-primary text-sm">Glissez votre fichier ici</p>
                        <p className="text-xs text-secondary mt-0.5">PDF, JPEG, PNG, WEBP · max 10 Mo</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
                        <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                          {fileIcon(file) === 'image'
                            ? <ImageIcon className="w-5 h-5 text-violet-500" />
                            : <FileText className="w-5 h-5 text-violet-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-primary truncate">{file.name}</p>
                          <p className="text-xs text-secondary">{(file.size / 1024).toFixed(0)} Ko</p>
                        </div>
                        <button onClick={() => setFile(null)} className="text-secondary hover:text-primary transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div>
                        <label className="text-xs text-secondary font-medium mb-1.5 block">Précisions pour l'IA <span className="text-secondary/50 font-normal">(optionnel)</span></label>
                        <textarea
                          value={pdfDescription}
                          onChange={e => setPdfDescription(e.target.value)}
                          placeholder="Ex: Concentre-toi sur la partie électricité. Ignorer les annexes administratives. TVA à 10% car rénovation logement existant."
                          rows={5}
                          className="w-full min-h-[8rem] max-h-[16rem] overflow-y-auto p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Result preview */}
          {currentQuote && (
            <div className="space-y-3">
              {/* En-tête : pagination + compteurs */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold text-primary">
                    {currentQuote.sections.length} section{currentQuote.sections.length > 1 ? 's' : ''} · {totalItems} ligne{totalItems > 1 ? 's' : ''}
                  </span>
                </div>
                <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors">
                  <RotateCcw className="w-3.5 h-3.5" />Recommencer
                </button>
              </div>

              {/* Navigation pagination si plusieurs devis */}
              {results.length > 1 && (
                <div className="flex items-center justify-between px-1">
                  <button
                    onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                    disabled={currentIndex === 0}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-semibold text-secondary">
                    Devis {currentIndex + 1} / {results.length}
                  </span>
                  <button
                    onClick={() => setCurrentIndex(i => Math.min(results.length - 1, i + 1))}
                    disabled={currentIndex === results.length - 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {currentQuote.title && (
                <div className="px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                  <p className="text-xs text-secondary uppercase tracking-wide font-semibold mb-0.5">Titre généré</p>
                  <p className="text-sm font-bold text-primary">{currentQuote.title}</p>
                </div>
              )}
              {currentQuote.sections.map((section: AIQuoteSection, si: number) => (
                <div key={si} className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
                  <div className="px-3 py-2 bg-black/5 dark:bg-white/5 border-b border-[var(--elevation-border)]">
                    <p className="text-xs font-bold text-primary uppercase tracking-wide">{section.title}</p>
                  </div>
                  <div className="divide-y divide-[var(--elevation-border)]">
                    {section.items.map((item: AIQuoteItem, ii: number) => (
                      <div key={ii} className="px-3 py-2.5 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-primary leading-snug">{item.description}</p>
                          <p className="text-xs text-secondary mt-0.5">{item.quantity} {item.unit} · TVA {item.vat_rate}%</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-semibold text-primary tabular-nums">{fmtPrice(item.unit_price)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {importedIndexes.has(currentIndex) && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <p className="text-xs text-green-700 dark:text-green-400 font-medium">Lignes ajoutées au devis avec succès</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--elevation-border)] space-y-2">
          {!currentQuote ? (
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || isAnalyzing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white text-sm font-semibold hover:from-violet-600 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isAnalyzing ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Analyse en cours...</>
              ) : (
                <><Bot className="w-4 h-4" />Analyser avec l'IA</>
              )}
            </button>
          ) : (
            <>
              {!importedIndexes.has(currentIndex) ? (
                <button
                  onClick={() => handleImport(currentIndex)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white text-sm font-semibold hover:from-violet-600 hover:to-indigo-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {results.length > 1 ? `Importer devis ${currentIndex + 1}` : 'Importer dans le devis'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : importedIndexes.size >= results.length ? (
                <button
                  onClick={onClose}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />Terminé, fermer le panneau
                </button>
              ) : (
                <button
                  onClick={() => {
                    const nextIndex = results.findIndex((_, i) => !importedIndexes.has(i))
                    if (nextIndex >= 0) setCurrentIndex(nextIndex)
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-surface border border-[var(--elevation-border)] text-primary text-sm font-semibold hover:bg-base transition-all"
                >
                  <ChevronRight className="w-4 h-4" />Voir le prochain devis à importer
                </button>
              )}
            </>
          )}
          <button onClick={onClose} className="w-full py-2 text-xs text-secondary hover:text-primary transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
