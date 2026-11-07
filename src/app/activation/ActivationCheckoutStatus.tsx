'use client'
// @atelier-migrated

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthLinkButton, AuthNotice } from '@/components/auth/AuthParts'

export function ActivationCheckoutStatus({ active }: { active: boolean }) {
  const router = useRouter()
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (active || attempts >= 8) return
    const timer = window.setTimeout(() => {
      setAttempts((current) => current + 1)
      router.refresh()
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [active, attempts, router])

  if (active) return null

  return (
    <AuthNotice tone="warning">
      Activation en cours. Nous vérifions votre abonnement Stripe… Si l’accès n’apparaît pas dans quelques instants, relancez la vérification ou écrivez à contact@orsayn.fr.
      {attempts >= 8 && (
        <>
          {' '}
          <AuthLinkButton onClick={() => router.refresh()}>Vérifier à nouveau</AuthLinkButton>
        </>
      )}
    </AuthNotice>
  )
}
