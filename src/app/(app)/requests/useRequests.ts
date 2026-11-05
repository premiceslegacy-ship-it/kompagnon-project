'use client'
// @atelier-migrated
// Logique des demandes de devis : liste, lecture, conversion en lead et devis, analyse d'un fichier joint.

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { QuoteRequest } from './page'
import { archiveRequest, convertRequestToLeadAndQuote, createQuoteFromCatalogRequest, markRequestRead } from '@/lib/data/mutations/quote-requests'
import { createQuote, upsertQuoteItem, upsertQuoteSection } from '@/lib/data/mutations/quotes'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import { countNew, filterRequests, type RequestFilter } from './requestsModel'

export function useRequests(initialRequests: QuoteRequest[]) {
  const [filter, setFilter] = useState<RequestFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Changements locaux (lecture, conversion) en attendant le prochain chargement du serveur.
  const [patches, setPatches] = useState<Record<string, Partial<Pick<QuoteRequest, 'status' | 'quote_id'>>>>({})
  const [, startTransition] = useTransition()

  const requests = initialRequests.map(r => ({ ...r, ...patches[r.id] }))
  const filtered = filterRequests(requests, filter)
  const newCount = countNew(requests)
  const selected = requests.find(r => r.id === selectedId) ?? null

  const patch = (id: string, change: Partial<Pick<QuoteRequest, 'status' | 'quote_id'>>) =>
    setPatches(prev => ({ ...prev, [id]: { ...prev[id], ...change } }))

  const open = (request: QuoteRequest) => {
    setSelectedId(request.id)
    if (request.status === 'new') {
      patch(request.id, { status: 'read' })
      startTransition(async () => { await markRequestRead(request.id) })
    }
  }

  return { filter, setFilter, filtered, newCount, selected, setSelectedId, open, patch }
}

export type RequestsState = ReturnType<typeof useRequests>

/** Actions d'une demande ouverte : convertir, générer un devis depuis le fichier joint, archiver. */
export function useRequestActions(request: QuoteRequest, patch: RequestsState['patch'], onArchived: () => void) {
  const router = useRouter()
  const pathname = usePathname()
  const [convertError, setConvertError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isConverting, setIsConverting] = useState(false)
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const isCatalog = request.type === 'catalog'

  const handleArchive = () => {
    startTransition(async () => {
      await archiveRequest(request.id)
      onArchived()
    })
  }

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
        patch(request.id, { status: 'converted', ...(res.quoteId ? { quote_id: res.quoteId } : {}) })
      }
      setIsConverting(false)
    })
  }

  async function handleAnalyzeWithAI() {
    if (!request.has_attachment || isAnalyzingAI) return
    setIsAnalyzingAI(true)
    setAiError(null)

    try {
      // Télécharger la pièce jointe via la route authentifiée et limitée à l'organisation.
      const fileRes = await fetch(`/api/requests/${encodeURIComponent(request.id)}/attachment`, { credentials: 'same-origin' })
      if (!fileRes.ok) throw new Error('Impossible de télécharger le fichier joint.')
      const blob = await fileRes.blob()
      const fileName = request.attachments?.[0]?.filename ?? 'document'
      const file = new File([blob], fileName, { type: blob.type })

      // Envoyer à l'API analyze-quote
      const formData = new FormData()
      formData.append('file', file)
      const aiRes = await fetch('/api/ai/analyze-quote', { method: 'POST', body: formData })
      const data = await aiRes.json()
      if (!aiRes.ok) throw new Error(data.error ?? 'Erreur lors de l\'analyse IA.')
      const result = (data as { quotes: AIQuoteResult[] }).quotes?.[0]
      if (!result) throw new Error('Réponse IA invalide.')

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

      const params = new URLSearchParams({ id: qId, returnTo: pathname })
      router.push(`/finances/quote-editor?${params}`)
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Erreur inconnue.')
    } finally {
      setIsAnalyzingAI(false)
    }
  }

  const openQuote = (quoteId: string) => {
    const params = new URLSearchParams({ id: quoteId, returnTo: pathname })
    router.push(`/finances/quote-editor?${params}`)
  }

  return { isCatalog, convertError, aiError, isPending, isConverting, isAnalyzingAI, handleConvert, handleArchive, handleAnalyzeWithAI, openQuote }
}
