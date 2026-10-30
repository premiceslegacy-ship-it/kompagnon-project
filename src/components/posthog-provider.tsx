'use client'

import { useEffect, useState, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

function PostHogPageview({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!enabled || !pathname) return
    const url = searchParams?.toString() ? `${pathname}?${searchParams.toString()}` : pathname
    posthog.capture('$pageview', { $current_url: url })
  }, [enabled, pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const key = root.dataset.posthogKey || process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return
    const host = root.dataset.posthogHost || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

    // Initialiser l'analytics après l'hydratation : aucune instrumentation du
    // navigateur ne doit modifier la page pendant que React la rattache au SSR.
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      person_profiles: 'identified_only',
    })
    posthog.register({ client_instance: window.location.host })
    setEnabled(true)

    const supabase = createClient()
    void supabase.auth.getUser().then((result: { data: { user: User | null } }) => {
      if (result.data.user) posthog.identify(result.data.user.id)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (session?.user) posthog.identify(session.user.id)
      else posthog.reset()
    })

    return () => authListener.subscription.unsubscribe()
  }, [])

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview enabled={enabled} />
      </Suspense>
      {children}
    </PHProvider>
  )
}
