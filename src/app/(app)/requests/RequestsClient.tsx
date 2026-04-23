'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { type QuoteRequest } from './page'
import { markRequestRead, archiveRequest, convertRequestToLeadAndQuote, createQuoteFromCatalogRequest } from '@/lib/data/mutations/quote-requests'
import { createQuote, upsertQuoteSection, upsertQuoteItem } from '@/lib/data/mutations/quotes'
import { AddressLink } from '@/components/shared/AddressLink'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import {
  Inbox, Archive, Mail, Phone, Building2, ExternalLink,
  ChevronDown, ChevronUp, Zap, Loader2, CheckCircle2,
  Paperclip, Ruler, Tag, FileText, Package, Bot, AlertCircle,
} from 'lucide-react'

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  new:       { label: 'Nouveau',  cls: 'bg-accent/10 text-accent' },
  read:      { label: 'Lu',       cls: 'bg-secondary/10 text-secondary' },
  converted: { label: 'Converti', cls: 'bg-accent-green/10 text-accent-green' },
  archived:  { label: 'Archivé',  cls: 'bg-secondary/10 text-secondary' },
}

function RequestCard({ request }: { request: QuoteRequest }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(request.status === 'new')
  const [status, setStatus] = useState(request.status)
  const [quoteId, setQuoteId] = useState(request.quote_id)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isConverting, setIsConverting] = useState(false)

  const badge = STATUS_LABELS[status] ?? STATUS_LABELS['read']
  const date = new Date(request.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const handleMarkRead = () => {
    if (status !== 'new') return
    setStatus('read')
    startTransition(async () => { await markRequestRead(request.id) })
  }

  const handleArchive = () => {
    startTransition(async () => { await archiveRequest(request.id) })
  }

  const isCatalog = request.type === 'catalog'

  const handleConvert = () => {
    if (isConverting) return
    setIsConverting(true)
    setConvertError(null)
    startTransition(async () => {
      const action = isCatalog ? createQuoteFromCatalogRequest : convertRequestToLeadAndQuote
      const res = await action(request.id)
      if (res.error) {
        setConvertError(res.error)
      } else {
        setStatus('converted')
        if (res.quoteId) setQuoteId(res.quoteId)
      }
      setIsConverting(false)
    })
  }

  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  async function handleAnalyzeWithAI() {
    if (!request.attachment_url || isAnalyzingAI) return
    setIsAnalyzingAI(true)
    setAiError(null)

    try {
      // Télécharger le fichier depuis Supabase Storage
      const fileRes = await fetch(request.attachment_url)
      if (!fileRes.ok) throw new Error('Impossible de télécharger le fichier joint.')
      const blob = await fileRes.blob()
      const fileName = request.attachment_url.split('/').pop() ?? 'document'
      const file = new File([blob], fileName, { type: blob.type })

      // Envoyer à l'API analyze-quote
      const formData = new FormData()
      formData.append('file', file)
      const aiRes = await fetch('/api/ai/analyze-quote', { method: 'POST', body: formData })
      const data = await aiRes.json()
      if (!aiRes.ok) throw new Error(data.error ?? 'Erreur lors de l\'analyse IA.')
      const result = data as AIQuoteResult

      // Créer le devis avec les sections et lignes générées
      const quoteRes = await createQuote({ clientId: null, title: result.title || 'Nouveau devis' })
      if (quoteRes.error || !quoteRes.quoteId) throw new Error(quoteRes.error ?? 'Impossible de créer le devis.')
      const qId = quoteRes.quoteId

      for (let si = 0; si < result.sections.length; si++) {
        const aiSec = result.sections[si]
        const secRes = await upsertQuoteSection({ quote_id: qId, title: aiSec.title, position: si + 1 })
        if (!secRes.sectionId) continue
        for (let ii = 0; ii < aiSec.items.length; ii++) {
          const item = aiSec.items[ii]
          await upsertQuoteItem({
            quote_id: qId,
            section_id: secRes.sectionId,
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
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Erreur inconnue.')
    } finally {
      setIsAnalyzingAI(false)
    }
  }

  const alreadyConverted = status === 'converted'

  return (
    <div className={`rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] overflow-hidden transition-all ${status === 'new' ? 'ring-1 ring-accent/40' : ''}`}>
      {/* Header */}
      <div
        className="flex items-start justify-between p-6 cursor-pointer hover:bg-accent/5 transition-colors"
        onClick={() => { setExpanded(e => !e); handleMarkRead() }}
      >
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-sm font-bold text-accent">
              {request.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <p className={`font-bold text-primary ${status === 'new' ? 'text-lg' : ''}`}>{request.name}</p>
              <span className={`px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}>
                {badge.label}
              </span>
              {request.type === 'catalog' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 flex items-center gap-1">
                  <Package className="w-2.5 h-2.5" />Catalogue
                </span>
              )}
              {request.prestation_type && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-base text-secondary border border-[var(--elevation-border)]">
                  {request.prestation_type}
                </span>
              )}
            </div>
            {request.subject && (
              <p className="text-sm text-secondary mt-0.5 truncate">{request.subject}</p>
            )}
            <p className="text-xs text-secondary/60 mt-1">{date}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {isPending && <Loader2 className="w-4 h-4 text-secondary animate-spin" />}
          {expanded ? <ChevronUp className="w-5 h-5 text-secondary" /> : <ChevronDown className="w-5 h-5 text-secondary" />}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-6 pb-6 space-y-5 border-t border-[var(--elevation-border)]">
          {/* Infos de contact */}
          <div className="flex flex-wrap gap-4 pt-4">
            <a href={`mailto:${request.email}`} className="flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors">
              <Mail className="w-4 h-4" />{request.email}
            </a>
            {request.phone && (
              <a href={`tel:${request.phone}`} className="flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors">
                <Phone className="w-4 h-4" />{request.phone}
              </a>
            )}
            {request.company_name && (
              <span className="flex items-center gap-2 text-sm text-secondary">
                <Building2 className="w-4 h-4" />{request.company_name}
              </span>
            )}
            <AddressLink
              address_line1={request.chantier_address_line1}
              postal_code={request.chantier_postal_code}
              city={request.chantier_city}
              className="text-sm text-secondary"
              textClassName="text-secondary hover:text-accent"
            />
          </div>

          {/* Items catalogue sélectionnés */}
          {isCatalog && request.catalog_items && request.catalog_items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
                <Package className="w-3.5 h-3.5" />Prestations sélectionnées
              </p>
              <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                {request.catalog_items.map((item, i) => (
                  <div key={i} className={`flex items-center justify-between px-4 py-3 text-sm ${i > 0 ? 'border-t border-[var(--elevation-border)]' : ''}`}>
                    <span className="text-primary font-medium">{item.description}</span>
                    <span className="text-secondary font-semibold ml-4 flex-shrink-0">× {item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prestation + Dimensions */}
          {(request.prestation_type || request.dimensions) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {request.prestation_type && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)]">
                  <Tag className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-0.5">Prestation</p>
                    <p className="text-sm text-primary">{request.prestation_type}</p>
                  </div>
                </div>
              )}
              {request.dimensions && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)]">
                  <Ruler className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-0.5">Dimensions</p>
                    <p className="text-sm text-primary">{request.dimensions}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <div className="rounded-2xl bg-base/50 border border-[var(--elevation-border)] p-5">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />Description du projet
            </p>
            <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap">{request.description}</p>
          </div>

          {/* Pièce jointe */}
          {request.attachment_url && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <a
                  href={request.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl bg-accent/5 border border-accent/20 hover:bg-accent/10 transition-colors group flex-1"
                >
                  <Paperclip className="w-4 h-4 text-accent flex-shrink-0" />
                  <span className="text-sm font-semibold text-accent flex-1">Voir le fichier joint</span>
                  <ExternalLink className="w-3.5 h-3.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
                {!alreadyConverted && (
                  <button
                    onClick={handleAnalyzeWithAI}
                    disabled={isAnalyzingAI}
                    title="Analyser ce document avec l'IA pour générer un devis"
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-500 font-semibold text-sm hover:bg-violet-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {isAnalyzingAI
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Analyse...</>
                      : <><Bot className="w-4 h-4" />Générer un devis avec l'IA</>
                    }
                  </button>
                )}
              </div>
              {aiError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-500">{aiError}</p>
                </div>
              )}
            </div>
          )}

          {/* Erreur conversion */}
          {convertError && (
            <p className="text-sm text-red-400 px-1">{convertError}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {alreadyConverted ? (
              <>
                <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-green/10 border border-accent-green/20 text-accent-green font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4" />Lead créé
                </div>
                {quoteId && (
                  <button
                    onClick={() => router.push(`/finances/quote-editor?id=${quoteId}`)}
                    className="px-5 py-2.5 rounded-full bg-accent text-black font-bold text-sm flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
                  >
                    <FileText className="w-4 h-4" />Voir le devis
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleConvert}
                disabled={isPending || isConverting}
                className="px-5 py-2.5 rounded-full bg-accent text-black font-bold text-sm flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isConverting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Conversion...</>
                  : isCatalog
                    ? <><Package className="w-4 h-4" />Créer client + devis catalogue</>
                    : <><Zap className="w-4 h-4" />Convertir en lead + devis</>
                }
              </button>
            )}

            <a
              href={`mailto:${request.email}?subject=Réponse à votre demande de devis${request.subject ? ` : ${request.subject}` : ''}`}
              className="px-5 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold text-sm flex items-center gap-2 hover:bg-base transition-all"
            >
              <Mail className="w-4 h-4" />Répondre
            </a>
            <button
              onClick={handleArchive}
              disabled={isPending}
              className="px-5 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold text-sm flex items-center gap-2 hover:bg-base transition-all disabled:opacity-60"
            >
              <Archive className="w-4 h-4" />Archiver
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RequestsClient({ initialRequests }: { initialRequests: QuoteRequest[] }) {
  const [filter, setFilter] = useState<'all' | 'new' | 'read'>('all')

  const filtered = initialRequests.filter(r =>
    filter === 'all' || r.status === filter
  )
  const newCount = initialRequests.filter(r => r.status === 'new').length

  return (
    <main className="flex-1 p-8 max-w-[1000px] mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold text-primary">Demandes de devis</h1>
            {newCount > 0 && (
              <span className="px-3 py-1 rounded-full bg-accent text-black text-sm font-bold">
                {newCount} nouveau{newCount > 1 ? 'x' : ''}
              </span>
            )}
          </div>
          <p className="text-secondary text-lg">Demandes reçues via votre formulaire public.</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)]">
        {([['all', 'Toutes'], ['new', 'Nouvelles'], ['read', 'Lues']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${filter === val ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map(req => <RequestCard key={req.id} request={req} />)}
        </div>
      ) : (
        <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] p-20 flex flex-col items-center gap-4 text-center">
          <Inbox className="w-12 h-12 text-secondary opacity-20" />
          <p className="text-xl font-bold text-primary">
            {filter === 'new' ? 'Aucune nouvelle demande' : 'Aucune demande pour le moment'}
          </p>
          <p className="text-secondary max-w-sm">
            {filter === 'new'
              ? 'Toutes les demandes ont été traitées.'
              : 'Partagez le lien de votre formulaire à vos prospects pour recevoir des demandes ici.'}
          </p>
        </div>
      )}
    </main>
  )
}
