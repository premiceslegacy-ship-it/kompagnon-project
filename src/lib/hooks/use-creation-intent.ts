'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useCreationIntent(allowed: boolean, onOpen: () => void): void {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requested = searchParams.get('new') === '1'
  const consumedRef = useRef(false)

  useEffect(() => {
    if (!requested) {
      consumedRef.current = false
      return
    }
    if (!allowed || consumedRef.current) return
    consumedRef.current = true
    onOpen()
    const remaining = new URLSearchParams(searchParams.toString())
    remaining.delete('new')
    const query = remaining.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}${window.location.hash}`, { scroll: false })
  }, [allowed, onOpen, pathname, requested, router, searchParams])
}
