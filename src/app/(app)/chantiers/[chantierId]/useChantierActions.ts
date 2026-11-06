'use client'
// @atelier-migrated
// Actions de statut de la fiche (reprendre, terminer, suspendre, annuler), duplication et archivage.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createChantier, deleteChantier, updateChantier } from '@/lib/data/mutations/chantiers'
import type { ChantierDetail } from '@/lib/data/queries/chantiers'
import type { ChantierStatus } from '../chantiersModel'

export function useChantierActions(chantier: ChantierDetail) {
  const router = useRouter()
  const [status, setStatus] = useState<ChantierStatus>(chantier.status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const changeStatus = async (next: ChantierStatus) => {
    const previous = status
    setStatus(next)
    setError(null)
    const { error: err } = await updateChantier(chantier.id, { status: next })
    if (err) {
      setStatus(previous)
      setError(err)
    }
  }

  const duplicate = async () => {
    setPending(true)
    setError(null)
    const { chantierId, error: err } = await createChantier({
      title: `${chantier.title} (copie)`,
      clientId: chantier.client?.id ?? null,
      addressLine1: chantier.address_line1 ?? null,
      postalCode: chantier.postal_code ?? null,
      city: chantier.city ?? null,
      startDate: null,
      estimatedEndDate: null,
      budgetHt: chantier.budget_ht ?? 0,
    })
    setPending(false)
    if (err || !chantierId) { setError(err ?? 'Duplication impossible.'); return }
    router.push(`/chantiers/${chantierId}`)
  }

  const archive = async () => {
    setPending(true)
    setError(null)
    const res = await deleteChantier(chantier.id)
    setPending(false)
    setConfirmArchive(false)
    if (res?.error) { setError(res.error); return }
    router.replace('/chantiers')
  }

  return { status, pending, error, setError, confirmArchive, setConfirmArchive, changeStatus, duplicate, archive }
}
