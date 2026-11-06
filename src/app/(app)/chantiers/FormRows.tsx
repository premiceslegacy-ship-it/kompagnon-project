'use client'
// @atelier-migrated

import { useId } from 'react'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

/** Ligne de formulaire « libellé à gauche, date ou heure à droite », dans un groupe de champs. */
export function DateRow({ label, value, onChange, type = 'date', required = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'date' | 'time'
  required?: boolean
}) {
  const id = useId()
  return (
    <div className={styles.fieldRow}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} className={styles.dateInput} value={value} required={required} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
