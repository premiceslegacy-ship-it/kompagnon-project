'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mic, MicOff, FileText, Bot, Loader2, Upload,
  CheckCircle2, AlertCircle, RotateCcw, ChevronRight, X, ImageIcon,
} from 'lucide-react'
import {
  createQuote,
  upsertQuoteSection,
  upsertQuoteItem,
} from '@/lib/data/mutations/quotes'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import { AI_NAME } from '@/lib/brand'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Mode = 'voice' | 'text' | 'pdf'

const ACCEPTED_FILE_TYPES = '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg,image/jpg'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

const fmtPrice = (n: number) =>
  n > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n) : '-'

// ─── Component ────────────────────────────────────────────────────────────────

export default function AtelierIAPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('voice')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pdfDescription, setPdfDescription] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [result, setResult] = useState<AIQuoteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Web Speech ─────────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Saisie vocale non supportée. Utilisez Chrome ou Edge.')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'fr-FR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any[])
        .map((r: any) => r[0].transcript)
        .join(' ')
      setText(transcript)
    }
    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') setError('Erreur micro : ' + event.error)
      setIsRecording(false)
    }
    recognition.onend = () => setIsRecording(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
    setError(null)
  }, [])

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop()
    setIsRecording(false)
  }, [])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  // ─── Analyze ─────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setResult(null)

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
      else setResult(data as AIQuoteResult)
    } catch {
      setError('Impossible de contacter l\'IA. Vérifiez votre connexion.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  // ─── Créer dans l'éditeur ─────────────────────────────────────────────────

  async function handleCreateInEditor() {
    if (!result) return
    setIsCreating(true)
    setError(null)

    try {
      const quoteRes = await createQuote({ clientId: null, title: result.title || 'Nouveau devis' })
      if (quoteRes.error || !quoteRes.quoteId) {
        setError(quoteRes.error ?? 'Impossible de créer le devis')
        setIsCreating(false)
        return
      }
      const qId = quoteRes.quoteId

      for (let si = 0; si < result.sections.length; si++) {
        const aiSec = result.sections[si]
        const secRes = await upsertQuoteSection({ quote_id: qId, title: aiSec.title, position: si + 1 })
        const sectionId = secRes.sectionId
        if (!sectionId) continue

        for (let ii = 0; ii < aiSec.items.length; ii++) {
          const item = aiSec.items[ii]
          await upsertQuoteItem({
            quote_id: qId,
            section_id: sectionId,
            type: 'custom',
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_price: item.unit_price,
            vat_rate: item.vat_rate,
            position: ii + 1,
          })
        }
      }

      router.push(`/finances/quote-editor?id=${qId}`)
    } catch {
      setError('Erreur lors de la création du devis')
      setIsCreating(false)
    }
  }

  function handleReset() {
    setText('')
    setFile(null)
    setPdfDescription('')
    setResult(null)
    setError(null)
  }

  function handleModeChange(m: Mode) {
    if (isRecording) stopRecording()
    setMode(m)
    handleReset()
  }

  const canAnalyze = mode === 'pdf' ? !!file : text.trim().length >= 5
  const totalItems = result?.sections.reduce((s, sec) => s + sec.items.length, 0) ?? 0

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 p-8 max-w-[1600px] mx-auto w-full">

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-primary">{AI_NAME}</h1>
          <p className="text-sm text-secondary">Génération assistée de devis par IA</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-220px)]">

        {/* ── Left panel — Input ───────────────────────────────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="rounded-3xl card p-6 flex flex-col flex-1 gap-4">

            {/* Mode switcher */}
            <div className="flex gap-1 p-1 rounded-xl bg-black/5 dark:bg-white/5">
              {([
                { id: 'voice', label: 'Vocal', icon: Mic },
                { id: 'text', label: 'Texte', icon: FileText },
                { id: 'pdf', label: 'Document', icon: ImageIcon },
              ] as const).map(({ id, label, icon: Icon }) => (
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

            {/* Input zone */}
            <div className="flex-1 flex flex-col">

              {mode === 'voice' && (
                <div className="flex-1 flex flex-col gap-4">
                  <p className="text-xs text-secondary">Décrivez les travaux à voix haute. L'IA structurera votre devis.</p>
                  <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-lg ${
                        isRecording
                          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                          : 'bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700'
                      }`}
                    >
                      {isRecording ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
                    </button>
                    <p className="text-sm text-secondary">
                      {isRecording ? 'Écoute en cours... (cliquez pour arrêter)' : 'Cliquez pour parler'}
                    </p>
                  </div>
                  {text && (
                    <div className="flex-1 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-[var(--elevation-border)] overflow-y-auto">
                      <p className="text-xs text-secondary font-medium mb-2">Transcription</p>
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
                    className="flex-1 p-4 rounded-2xl bg-base border border-[var(--elevation-border)] text-primary text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                  />
                </div>
              )}

              {mode === 'pdf' && (
                <div className="flex-1 flex flex-col gap-2">
                  <p className="text-xs text-secondary">Importez un cahier des charges PDF ou une photo de plan (PNG, JPEG). L'IA extraira automatiquement les postes.</p>
                  {!file ? (
                    <div
                      className="flex-1 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl flex flex-col items-center justify-center gap-4 text-secondary hover:border-violet-400/50 hover:bg-violet-500/5 transition-all cursor-pointer"
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
                      <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                        <Upload className="w-7 h-7 text-violet-500" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-primary text-sm">Glissez votre document ici</p>
                        <p className="text-xs text-secondary mt-1">PDF, PNG ou JPEG — max 10 Mo</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-4">
                      <div className="flex flex-col items-center justify-center gap-4">
                        {file.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt="Aperçu"
                            className="max-h-40 rounded-xl object-contain border border-[var(--elevation-border)]"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                            <FileText className="w-8 h-8 text-violet-500" />
                          </div>
                        )}
                        <div className="text-center">
                          <p className="font-semibold text-primary text-sm">{file.name}</p>
                          <p className="text-xs text-secondary mt-1">{(file.size / 1024).toFixed(0)} Ko</p>
                        </div>
                        <button
                          onClick={() => setFile(null)}
                          className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Supprimer
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-secondary font-medium mb-1.5 block">
                          Précisions pour l'IA <span className="text-secondary/50 font-normal">(optionnel)</span>
                        </label>
                        <textarea
                          value={pdfDescription}
                          onChange={e => setPdfDescription(e.target.value)}
                          placeholder="Ex: Concentre-toi sur la partie plomberie. Ignore les pages administratives. TVA à 10% car rénovation d'un logement existant."
                          rows={4}
                          className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 leading-relaxed placeholder:text-secondary/50"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Analyze button */}
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || isAnalyzing}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-bold hover:from-violet-600 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-500/20"
            >
              {isAnalyzing ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Analyse en cours...</>
              ) : (
                <><Bot className="w-5 h-5" />Analyser avec l'IA</>
              )}
            </button>
          </div>
        </div>

        {/* ── Right panel — Result ─────────────────────────────────────────── */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="rounded-3xl card p-6 flex-1 flex flex-col overflow-hidden">

            {!result && !isAnalyzing && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-secondary">
                <div className="w-20 h-20 rounded-3xl bg-violet-500/10 flex items-center justify-center">
                  <Bot className="w-10 h-10 text-violet-400 opacity-50" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-primary">Prêt à générer</p>
                  <p className="text-sm text-secondary mt-1">Décrivez votre projet à gauche, l'IA structurera le devis ici.</p>
                </div>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" />
                <p className="font-bold text-primary animate-pulse">Analyse en cours...</p>
                <p className="text-xs text-secondary">L'IA structure votre devis</p>
              </div>
            )}

            {result && (
              <div className="flex flex-col h-full">
                {/* Result header */}
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="font-bold text-primary">
                      {result.sections.length} section{result.sections.length > 1 ? 's' : ''} · {totalItems} ligne{totalItems > 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Recommencer
                  </button>
                </div>

                {/* Sections */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {result.sections.map((section, si) => (
                    <div key={si} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                      <div className="px-4 py-2.5 bg-black/5 dark:bg-white/5">
                        <p className="text-xs font-bold text-primary uppercase tracking-wider">{section.title}</p>
                      </div>
                      <div className="divide-y divide-[var(--elevation-border)]">
                        {section.items.map((item, ii) => (
                          <div key={ii} className="px-4 py-3 flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-primary leading-snug">{item.description}</p>
                              <p className="text-xs text-secondary mt-0.5">
                                {item.quantity} {item.unit} · TVA {item.vat_rate}%
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
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
                <div className="mt-4 flex-shrink-0">
                  <button
                    onClick={handleCreateInEditor}
                    disabled={isCreating}
                    className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-bold hover:from-violet-600 hover:to-indigo-700 disabled:opacity-60 transition-all shadow-lg shadow-violet-500/20"
                  >
                    {isCreating ? (
                      <><Loader2 className="w-5 h-5 animate-spin" />Création en cours...</>
                    ) : (
                      <><FileText className="w-5 h-5" />Ouvrir dans l'éditeur<ChevronRight className="w-5 h-5" /></>
                    )}
                  </button>
                  <p className="text-xs text-secondary text-center mt-2">
                    Le devis sera créé et vous serez redirigé vers l'éditeur pour finaliser et assigner un client.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
