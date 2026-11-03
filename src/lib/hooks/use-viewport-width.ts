'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function clientWidth(): number | null {
  return typeof window === 'undefined' ? null : window.innerWidth
}

function serverWidth(): null {
  return null
}

/** The first hydration render matches SSR; viewport-dependent geometry updates afterwards. */
export function useViewportWidth(): number | null {
  return useSyncExternalStore(subscribe, clientWidth, serverWidth)
}
