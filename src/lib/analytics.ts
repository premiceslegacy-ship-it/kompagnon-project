'use client'

import posthog from 'posthog-js'

/**
 * Événements métier explicites — suivi de base PostHog (pas d'autocapture).
 * No-op silencieux si PostHog n'est pas configuré (client sans NEXT_PUBLIC_POSTHOG_KEY).
 */
export function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  posthog.capture(name, properties)
}
