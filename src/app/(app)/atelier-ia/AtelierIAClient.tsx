'use client'
// @atelier-migrated

import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Mic, Square } from 'lucide-react'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { AI_NAME } from '@/lib/brand'
import { MEASUREMENT_TRADE_LABELS, PLAN_MEASUREMENT_TRADES, type PlanWorkScope } from '@/lib/plan-measurement'
import { ACCEPTED_FILE_TYPES, ACCEPTED_MIME_TYPES, fmtPrice, splitDetails, type Mode } from './atelierIAModel'
import { MeasurementReview } from './MeasurementReview'
import { useAtelierIA, type AtelierIAProps } from './useAtelierIA'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import ia from './AtelierIA.module.css'

const NB = ' '

const MODES = [
  { value: 'voice', label: 'Vocal' },
  { value: 'text', label: 'Texte' },
  { value: 'pdf', label: 'Document' },
  { value: 'measure', label: 'Plan' },
] as const

const SCOPES: { value: PlanWorkScope; label: string }[] = [
  { value: 'create', label: 'Création' },
  { value: 'replace', label: 'Remplacement' },
  { value: 'remove', label: 'Dépose' },
  { value: 'preserve', label: 'Conservation' },
]

export default function AtelierIAClient(props: AtelierIAProps) {
  const q = useAtelierIA(props)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { mode, file, currentQuote, measurement } = q
  const fileMode = mode === 'pdf' || mode === 'measure'
  const quote = currentQuote

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        {q.creditsError && <AICreditsErrorModal onClose={() => q.setCreditsError(false)} />}

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Dicter, décrire ou importer un document</p>
            <h1 className={screen.title}>Devis avec {AI_NAME}</h1>
          </div>
        </header>

        {q.briefBanner && <p className={ia.banner} role="status">{q.briefBanner}</p>}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {!measurement && !quote && !q.isAnalyzing && (
            <>
              <SegmentedControl fullWidth label="Source du devis" value={mode} options={MODES} onChange={v => q.handleModeChange(v as Mode)} />

              {mode === 'voice' && (
                <section className={ia.voice} aria-label="Dictée">
                  <p className={ia.lead}>Décrivez les travaux à voix haute. {AI_NAME} structure le devis pour vous.</p>
                  <Button
                    size="lg"
                    variant={q.isRecording ? 'destructive' : 'primary'}
                    disabled={q.isTranscribing}
                    onClick={q.isRecording ? q.stopRecording : q.startRecording}
                  >
                    {q.isRecording ? <Square size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
                    &nbsp;{q.isRecording ? 'Arrêter l’enregistrement' : 'Démarrer l’enregistrement'}
                  </Button>
                  <p className={ia.state} role="status">
                    {q.isRecording ? 'Enregistrement en cours…' : q.isTranscribing ? 'Transcription en cours…' : 'Touchez le bouton pour parler'}
                  </p>
                  {q.text && (
                    <ListGroup title="Transcription">
                      <li><p className={styles.requestText}>{q.text}</p></li>
                    </ListGroup>
                  )}
                </section>
              )}

              {mode === 'text' && (
                <div className={styles.detail}>
                  <p className={ia.lead}>Décrivez librement les travaux à réaliser.</p>
                  <div className={styles.fields}>
                    <textarea
                      className={styles.textarea}
                      aria-label="Description des travaux"
                      style={{ minHeight: 220 }}
                      value={q.text}
                      onChange={e => q.setText(e.target.value)}
                      placeholder="Ex : Rénovation complète d'une salle de bain de 8 m² : dépose de l'ancien carrelage, pose de carrelage sol et mur (format 60×60), remplacement de la douche…"
                    />
                  </div>
                </div>
              )}

              {fileMode && (
                <div className={styles.detail}>
                  {mode === 'measure' && (
                    <>
                      <ListGroup title="Périmètre du métré" action={<Button variant="text" size="sm" onClick={() => void q.resumeLatestMeasurement()}>Reprendre le dernier</Button>}>
                        <li className={styles.panel}>
                          <SegmentedControl
                            fullWidth
                            label="Type de projet"
                            value={q.projectType}
                            options={[{ value: 'renovation', label: 'Rénovation' }, { value: 'new', label: 'Neuf' }]}
                            onChange={v => q.changeProjectType(v as 'renovation' | 'new')}
                          />
                        </li>
                        {PLAN_MEASUREMENT_TRADES.map(trade => {
                          const checked = q.selectedTrades.includes(trade)
                          return (
                            <ListRow
                              key={trade}
                              title={MEASUREMENT_TRADE_LABELS[trade]}
                              trailing={<Switch label={`Inclure ${MEASUREMENT_TRADE_LABELS[trade]}`} checked={checked} onChange={() => q.toggleMeasurementTrade(trade)} />}
                            />
                          )
                        })}
                      </ListGroup>
                      {q.selectedTrades.length === 0 && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>Sélectionnez au moins un lot.</p>}
                      {q.selectedTrades.length > 0 && (
                        <ListGroup title="Intervention par lot">
                          <li className={styles.panel}>
                            <div className={styles.fields}>
                              {q.selectedTrades.map(trade => (
                                <Field
                                  key={trade}
                                  type="select"
                                  label={MEASUREMENT_TRADE_LABELS[trade]}
                                  value={q.workScopes[trade] ?? (q.projectType === 'new' ? 'create' : 'replace')}
                                  onChange={e => q.setWorkScopes(current => ({ ...current, [trade]: e.target.value as PlanWorkScope }))}
                                >
                                  {SCOPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </Field>
                              ))}
                            </div>
                          </li>
                        </ListGroup>
                      )}
                      <div className={styles.fields}>
                        <Field type="number" label="Hauteur sous plafond (m)" min={1} decimals={2} value={q.measurementSettings.defaultHeightM}
                          onChange={v => q.setMeasurementSettings(current => ({ ...current, defaultHeightM: Math.max(1, v ?? 1) }))} />
                        <Field type="number" label="Pertes (%)" min={0} max={50} decimals={1} value={q.measurementSettings.wastePct}
                          onChange={v => q.setMeasurementSettings(current => ({ ...current, wastePct: Math.max(0, v ?? 0) }))} />
                      </div>
                    </>
                  )}

                  <p className={ia.lead}>
                    {mode === 'measure'
                      ? `Importez un plan PDF ou une photo de plan. ${AI_NAME} prépare un pré-métré à valider.`
                      : `Importez un cahier des charges PDF, une demande client ou une photo de document. ${AI_NAME} extrait les postes pour vous.`}
                  </p>

                  <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} hidden aria-label="Document à analyser"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { q.setFile(f); q.setError(null) } }} />
                  {!file ? (
                    <div
                      className={ia.drop}
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        const dropped = e.dataTransfer.files[0]
                        if (dropped && ACCEPTED_MIME_TYPES.has(dropped.type)) { q.setFile(dropped); q.setError(null) }
                        else q.setError('Formats acceptés : PDF, PNG, JPEG')
                      }}
                    >
                      <b>Choisir ou glisser un document</b>
                      <span>PDF, PNG ou JPEG, 10{NB}Mo maximum</span>
                    </div>
                  ) : (
                    <ListGroup title="Document">
                      {file.type.startsWith('image/') && (
                        <li className={ia.preview}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={URL.createObjectURL(file)} alt="Aperçu du document" />
                        </li>
                      )}
                      <ListRow title={file.name} description={`${(file.size / 1024).toFixed(0)}${NB}Ko`} trailing={<Button variant="text" size="sm" onClick={() => q.setFile(null)}>Retirer</Button>} />
                    </ListGroup>
                  )}

                  <Field
                    type="textarea"
                    label={`Précisions pour ${AI_NAME}`}
                    rows={4}
                    controlClassName={styles.areaCompact}
                    value={q.pdfDescription}
                    onChange={e => q.setPdfDescription(e.target.value)}
                    hint="Facultatif"
                    placeholder={mode === 'measure'
                      ? 'Ex : Hauteur sous plafond 2,50 m. Fais surtout le placo : cloisons, doublages, plafonds, bandes. Ignore l\'électricité.'
                      : 'Ex : Concentre-toi sur la partie plomberie. Ignore les pages administratives. TVA à 10 % car rénovation d\'un logement existant.'}
                  />
                </div>
              )}

              {q.error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{q.error}</p>}
              <Button size="lg" disabled={!q.canAnalyze} onClick={() => void q.handleAnalyze()}>
                {mode === 'measure' ? 'Analyser le plan' : `Confier à ${AI_NAME}`}
              </Button>
            </>
          )}

          {q.isAnalyzing && (
            <section className={ia.working} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <b>{AI_NAME} analyse…</b>
              <span>{q.analyzeStage}</span>
            </section>
          )}

          {measurement && mode === 'measure' && !q.isAnalyzing && <MeasurementReview q={q} />}

          {quote && !q.isAnalyzing && (
            <>
              <div className={styles.inline} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <p className={ia.count}>{quote.sections.length}{NB}section{quote.sections.length > 1 ? 's' : ''} · {q.totalItems}{NB}ligne{q.totalItems > 1 ? 's' : ''}</p>
                <Button variant="text" size="sm" onClick={q.handleReset}>Recommencer</Button>
              </div>

              {q.results.length > 1 && (
                <div className={ia.pager}>
                  <button type="button" className={screen.round} aria-label="Devis précédent" disabled={q.currentIndex === 0} onClick={() => q.setCurrentIndex(i => Math.max(0, i - 1))}><ChevronLeft size={20} aria-hidden="true" /></button>
                  <span className={ia.pagerLabel}>Devis {q.currentIndex + 1} / {q.results.length}{quote.title ? <small>{quote.title}</small> : null}</span>
                  <button type="button" className={screen.round} aria-label="Devis suivant" disabled={q.currentIndex === q.results.length - 1} onClick={() => q.setCurrentIndex(i => Math.min(q.results.length - 1, i + 1))}><ChevronRight size={20} aria-hidden="true" /></button>
                </div>
              )}

              {(quote.clientName || quote.clientDraft) && (
                <ListGroup title="Client détecté">
                  <ListRow
                    title={quote.clientDraft?.company_name || quote.clientName || [quote.clientDraft?.first_name, quote.clientDraft?.last_name].filter(Boolean).join(' ')}
                    description={[quote.clientDraft?.contact_name ? `Réf. : ${quote.clientDraft.contact_name}` : null, quote.clientDraft?.siret ? `SIRET : ${quote.clientDraft.siret}` : null].filter(Boolean).join(' · ') || undefined}
                  />
                </ListGroup>
              )}

              {(quote.quoteWarnings?.length ?? 0) > 0 && (
                <ListGroup title="À vérifier">
                  {quote.quoteWarnings!.slice(0, 5).map((warning, wi) => <ListRow key={wi} title={warning} />)}
                </ListGroup>
              )}

              {quote.sections.map((section, si) => (
                <ListGroup key={si} title={section.title || `Section ${si + 1}`}>
                  {section.items.map((item, ii) => {
                    const legacy = splitDetails(item.description)
                    const designation = item.designation?.trim() || legacy.designation
                    const details = item.details?.trim() || legacy.details
                    const meta = [
                      `${item.quantity}${NB}${item.unit} · TVA ${item.vat_rate}${NB}%`,
                      item.ai_source ?? null,
                      item.ai_confidence != null ? `${Math.round(item.ai_confidence * 100)}${NB}% confiance` : null,
                      ...(item.ai_warnings?.slice(0, 2) ?? []),
                    ].filter(Boolean).join(' · ')
                    return (
                      <ListRow
                        key={ii}
                        title={designation}
                        description={[meta, details].filter(Boolean).join('\n')}
                        trailing={<span className={styles.amount}>{fmtPrice(item.unit_price)}</span>}
                      />
                    )
                  })}
                </ListGroup>
              ))}

              <Button size="lg" loading={q.isCreating} onClick={() => void q.handleCreateInEditor()}>
                {q.results.length > 1 ? `Créer les ${q.results.length} devis et ouvrir` : 'Ouvrir dans l\'éditeur'}
              </Button>
              <p className={styles.hint} style={{ textAlign: 'center', marginTop: -8 }}>
                {q.results.length > 1
                  ? 'Tous les devis seront créés. Vous serez redirigé vers celui affiché ici.'
                  : 'Le devis sera créé et vous serez redirigé vers l\'éditeur pour finaliser.'}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
