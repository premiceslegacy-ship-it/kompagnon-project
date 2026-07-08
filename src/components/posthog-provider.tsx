'use client'

import { useEffect, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { getClientInstanceLabel } from '@/lib/client-instance'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

// Suivi de base uniquement : pages vues + événements métier explicites
// (voir /lib/analytics.ts). Pas d'autocapture de clics/formulaires, pas de
// session recording — app métier avec des données financières/personnelles
// à l'écran (montants, coordonnées clients).
if (typeof window !== 'undefined' && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false, // capturé manuellement via PostHogPageview ci-dessous
    disable_session_recording: true,
    person_profiles: 'identified_only',
  })
  // Compte PostHog Orsayn partagé entre tous les clients per-client : cette
  // propriété est attachée à chaque événement pour filtrer par instance
  // déployée dans les dashboards (group by client_instance).
  posthog.register({ client_instance: getClientInstanceLabel() })
}

function PostHogPageview() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!POSTHOG_KEY || !pathname) return
    const url = searchParams?.toString() ? `${pathname}?${searchParams.toString()}` : pathname
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_KEY) return <>{children}</>

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PHProvider>
  )
}
