'use client'
// @atelier-migrated

import type { ReactNode } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import styles from './SarahWidget.module.css'

type SarahSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function SarahSheet({ open, onOpenChange, children }: SarahSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Assistante" className={styles.sheet}>
      {children}
    </Sheet>
  )
}
