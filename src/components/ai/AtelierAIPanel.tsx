'use client'
// @atelier-migrated

import { useState, useRef, useEffect, useCallback } from 'react'
import type { AIQuoteResult, AIQuoteSection, AIQuoteItem } from '@/app/api/ai/analyze-quote/route'
import { AI_NAME } from '@/lib/brand'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = 'voice' | 'text' | 'pdf'

type Props = {
  onImport: (result: AIQuoteResult) => void
  onClose: () => void
  voiceInputEnabled?: boolean
  briefBanner?: string | null
  // Description transmise par Sarah : l’assistante lance l’analyse automatiquement
  // au chargement pour proposer les lignes directement, sans saisie manuelle.
  autoAnalyzeText?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']
const BASE_MODES: Array<{ id: Mode; label: string }> = [
  { id: 'text', label: 'Texte' },
  { id: 'pdf', label: 'Fichier' },
]

function isAccepted(f: File) {
  return ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext))
}

const fmtPrice = (n: number) =>
  n > 0
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
    : '-'

// ─── Component ───────────────────────────────────────────────────────────────

export default function AtelierAIPanel({ onImport, onClose, voiceInputEnabled = true, briefBanner = null, autoAnalyzeText = null }: Props) {
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
          if (!res.ok) setError(data?.code === 'permission_denied' ? 'Vous n’avez pas accès à la transcription vocale.' : 'La transcription vocale n’a pas abouti. Réessayez dans un instant.')
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

  const handleAnalyze = useCallback(async (overrideText?: string) => {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setResults([])
    setCurrentIndex(0)
    setImportedIndexes(new Set())

    try {
      let res: Response
      if (mode === 'pdf' && file && overrideText === undefined) {
        const formData = new FormData()
        formData.append('file', file)
        if (pdfDescription.trim()) formData.append('description', pdfDescription.trim())
        res = await fetch('/api/ai/analyze-quote', { method: 'POST', body: formData })
      } else {
        res = await fetch('/api/ai/analyze-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: overrideText ?? text }),
        })
      }
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400 && typeof data.error === 'string') {
          setError(data.error)
        } else if (data?.code === 'permission_denied' || res.status === 403) {
          setError('L’assistance à la création de devis n’est pas disponible pour ce compte.')
        } else if (res.status === 429) {
          setError('Trop de demandes. Réessayez dans un instant.')
        } else {
          setError('L’analyse du devis n’a pas abouti. Réessayez dans un instant.')
        }
      } else {
        setResults((data as { quotes: AIQuoteResult[] }).quotes ?? [])
      }
    } catch {
      setError('Impossible de contacter l\'IA. Vérifiez votre connexion.')
    } finally {
      setIsAnalyzing(false)
    }
  }, [isRecording, stopRecording, mode, file, pdfDescription, text])

  // Auto-analyse à partir du brief Sarah : on bascule en mode texte, on
  // pré-remplit la description et on lance l’assistante une seule fois.
  const autoAnalyzeDoneRef = useRef(false)
  useEffect(() => {
    if (autoAnalyzeDoneRef.current) return
    const brief = autoAnalyzeText?.trim()
    if (!brief) return
    autoAnalyzeDoneRef.current = true
    setMode('text')
    setText(brief)
    handleAnalyze(brief)
  }, [autoAnalyzeText, handleAnalyze])

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
  const availableModes: Array<{ id: Mode; label: string }> = voiceInputEnabled
    ? [{ id: 'voice', label: 'Voix' }, ...BASE_MODES]
    : BASE_MODES

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const allImported = importedIndexes.size >= results.length
  const alreadyImported = importedIndexes.has(currentIndex)
  let confirmLabel = `Confier à ${AI_NAME}`
  let onConfirm: () => void = () => handleAnalyze()
  let confirmDisabled = !canAnalyze
  if (currentQuote) {
    confirmDisabled = false
    if (!alreadyImported) {
      confirmLabel = results.length > 1 ? `Importer le devis ${currentIndex + 1}` : 'Importer dans le devis'
      onConfirm = () => handleImport(currentIndex)
    } else if (allImported) {
      confirmLabel = 'Terminé'
      onConfirm = onClose
    } else {
      confirmLabel = 'Voir le devis suivant'
      onConfirm = () => {
        const nextIndex = results.findIndex((_, i) => !importedIndexes.has(i))
        if (nextIndex >= 0) setCurrentIndex(nextIndex)
      }
    }
  }
  const hint = (message: string) => <p className={styles.hint} style={{ marginTop: 0 }}>{message}</p>

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={`${AI_NAME}, devis`}
      description="Décrivez les travaux, l’assistante prépare les lignes."
      cancelLabel="Fermer"
      onConfirm={onConfirm}
      confirmLabel={confirmLabel}
      confirmLoading={isAnalyzing}
      confirmDisabled={confirmDisabled}
    >
      <div className={styles.detail}>
        {briefBanner && hint(briefBanner)}

        {!currentQuote && (
          <>
            <SegmentedControl
              fullWidth
              label="Mode de saisie"
              value={mode}
              options={availableModes.map(m => ({ value: m.id, label: m.label }))}
              onChange={v => handleModeChange(v as Mode)}
            />

            {mode === 'voice' && (
              <>
                {hint(`Décrivez les travaux à voix haute. ${AI_NAME} structure votre devis.`)}
                <div className={styles.inline}>
                  <Button variant="secondary" size="lg" onClick={isRecording ? stopRecording : startRecording} disabled={isTranscribing}>
                    {isRecording ? 'Arrêter l’enregistrement' : 'Parler'}
                  </Button>
                </div>
                {isRecording && hint('Enregistrement en cours…')}
                {isTranscribing && hint('Transcription en cours…')}
                {text && (
                  <ListGroup title="Transcription">
                    <ListRow title={text} />
                  </ListGroup>
                )}
              </>
            )}

            {mode === 'text' && (
              <div className={styles.fields}>
                <Field
                  type="textarea"
                  label="Travaux"
                  hint="Décrivez librement, l’assistante s’occupe de la structure."
                  rows={10}
                  placeholder="Salle de bain de 8 m² : dépose du carrelage, pose de carrelage 60×60, douche à l’italienne, nouveau lavabo…"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
              </div>
            )}

            {mode === 'pdf' && (
              <>
                {hint(`Importez un PDF ou une image (photo, plan scanné). ${AI_NAME} en extrait les postes. 10 Mo au plus.`)}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  hidden
                  aria-label="Fichier à analyser"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (isAccepted(f)) { setFile(f); setError(null) }
                    else setError('Formats acceptés : PDF, JPEG, PNG, WEBP')
                    e.target.value = ''
                  }}
                />
                {!file ? (
                  <div
                    className={styles.inline}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const dropped = e.dataTransfer.files[0]
                      if (!dropped) return
                      if (isAccepted(dropped)) { setFile(dropped); setError(null) }
                      else setError('Formats acceptés : PDF, JPEG, PNG, WEBP')
                    }}
                  >
                    <Button variant="secondary" size="md" onClick={() => fileInputRef.current?.click()}>Choisir un fichier</Button>
                  </div>
                ) : (
                  <>
                    <ListGroup>
                      <ListRow
                        title={file.name}
                        description={`${(file.size / 1024).toFixed(0)} Ko`}
                        trailing={<Button variant="text" size="sm" onClick={() => setFile(null)}>Retirer</Button>}
                      />
                    </ListGroup>
                    <div className={styles.fields}>
                      <Field
                        type="textarea"
                        label={`Précisions pour ${AI_NAME}`}
                        hint="Facultatif."
                        rows={5}
                        placeholder="Se concentrer sur l’électricité, ignorer les annexes, TVA à 10 % (rénovation de logement existant)…"
                        value={pdfDescription}
                        onChange={e => setPdfDescription(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
          </>
        )}

        {currentQuote && (
          <>
            <div className={styles.inline}>
              <Button variant="text" size="sm" onClick={handleReset}>Recommencer</Button>
              {results.length > 1 && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}>Précédent</Button>
                  <Button variant="secondary" size="sm" onClick={() => setCurrentIndex(i => Math.min(results.length - 1, i + 1))} disabled={currentIndex === results.length - 1}>Suivant</Button>
                </>
              )}
            </div>
            {hint(`${results.length > 1 ? `Devis ${currentIndex + 1} sur ${results.length} · ` : ''}${currentQuote.sections.length} lot${currentQuote.sections.length > 1 ? 's' : ''} · ${totalItems} ligne${totalItems > 1 ? 's' : ''}`)}
            {(currentQuote.title || currentQuote.clientName || currentQuote.clientDraft) && (
              <ListGroup>
                {currentQuote.title && <ListRow title={currentQuote.title} description="Titre proposé" />}
                {(currentQuote.clientName || currentQuote.clientDraft) && (
                  <ListRow
                    title={currentQuote.clientDraft?.company_name || currentQuote.clientName || [currentQuote.clientDraft?.first_name, currentQuote.clientDraft?.last_name].filter(Boolean).join(' ')}
                    description={currentQuote.clientDraft?.siret ? `Client détecté · SIRET ${currentQuote.clientDraft.siret}` : 'Client détecté'}
                  />
                )}
              </ListGroup>
            )}
            {(currentQuote.quoteWarnings?.length ?? 0) > 0 && (
              <ListGroup title="À vérifier">
                {currentQuote.quoteWarnings!.slice(0, 4).map((warning, wi) => <ListRow key={wi} title={warning} />)}
              </ListGroup>
            )}
            {currentQuote.sections.map((section: AIQuoteSection, si: number) => (
              <ListGroup key={si} title={section.title}>
                {section.items.map((item: AIQuoteItem, ii: number) => (
                  <ListRow
                    key={ii}
                    title={item.description}
                    description={`${item.quantity} ${item.unit} · TVA ${item.vat_rate} %`}
                    trailing={<span className={styles.fieldValue}>{fmtPrice(item.unit_price)}</span>}
                  />
                ))}
              </ListGroup>
            ))}
            {alreadyImported && hint('Lignes ajoutées au devis.')}
          </>
        )}
      </div>
    </Sheet>
  )
}
