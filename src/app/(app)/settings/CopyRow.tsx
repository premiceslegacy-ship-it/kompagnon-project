'use client'
// @atelier-migrated
// Ligne de liste qui copie un texte dans le presse-papiers et confirme brièvement.

import { useEffect, useRef, useState } from 'react'
import { ListRow } from '@/components/ui/ListGroup'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

export default function CopyRow({ text, label, doneLabel }: { text: string; label: string; doneLabel: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(text) } catch { return }
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return <ListRow title={copied ? doneLabel : label} className={styles.accentRow} onClick={() => void copy()} />
}
