'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Chantier, ChantierStats } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import { createChantier } from '@/lib/data/mutations/chantiers'
import { useCreationIntent } from '@/lib/hooks/use-creation-intent'
import { paginate } from '@/lib/pagination'
import {
  EMPTY_CHANTIER_FORM, applyQuoteToForm, filterChantiers,
  type ChantierStatus, type NewChantierForm,
} from './chantiersModel'

export type ChantiersProps = {
  initialChantiers: Chantier[]
  stats: ChantierStats
  clients: Client[]
  linkableQuotes: QuoteStub[]
  canCreate?: boolean
  canDelete?: boolean
}

export function useChantiers({ initialChantiers, canCreate = false }: ChantiersProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<ChantierStatus | 'tous'>('tous')
  const [createStep, setCreateStep] = useState<'choice' | 'form' | null>(null)
  const openCreateChoice = useCallback(() => setCreateStep(current => current ?? 'choice'), [])
  useCreationIntent(canCreate, openCreateChoice)
  const [isNavigating, setIsNavigating] = useState(false)
  const [navigationLabel, setNavigationLabel] = useState('Ouverture du chantier...')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => filterChantiers(initialChantiers, search, filterStatus), [initialChantiers, search, filterStatus])
  const pageData = paginate(filtered, page)

  const goTo = (href: string, label: string) => {
    setNavigationLabel(label)
    setIsNavigating(true)
    router.push(href)
  }

  return {
    search, setSearch, filterStatus, setFilterStatus, createStep, setCreateStep,
    isNavigating, navigationLabel, page, setPage, filtered, pageData, goTo,
  }
}

/** État du formulaire « Nouveau chantier » : valeurs, pré-remplissage depuis un devis, envoi. */
export function useNewChantierForm(linkableQuotes: QuoteStub[], onCreated: (id: string) => void) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<NewChantierForm>(EMPTY_CHANTIER_FORM)

  const set = (field: keyof NewChantierForm, value: string) => setForm(f => ({ ...f, [field]: value }))
  const handleQuoteChange = (quoteId: string) => setForm(f => applyQuoteToForm(f, quoteId, linkableQuotes))

  const submit = async () => {
    setLoading(true)
    setError(null)
    const { chantierId, error: err } = await createChantier({
      title: form.title,
      clientId: form.clientId || null,
      addressLine1: form.addressLine1 || null,
      postalCode: form.postalCode || null,
      city: form.city || null,
      startDate: form.startDate || null,
      estimatedEndDate: form.estimatedEndDate || null,
      budgetHt: form.budgetHt ? parseFloat(form.budgetHt) : 0,
      contactName: form.contactName || null,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      quoteId: form.quoteId || null,
    })
    setLoading(false)
    if (err) return setError(err)
    onCreated(chantierId!)
  }

  return { form, set, handleQuoteChange, submit, loading, error }
}
