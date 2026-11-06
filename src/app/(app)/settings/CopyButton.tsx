'use client'
// @atelier-migrated
// Copie un texte dans le presse-papiers et confirme brièvement.

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(text) } catch { return }
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void copy()} aria-live="polite">
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {copied ? 'Copié' : label}
    </Button>
  )
}
