'use client'

import React, { useRef, useState } from 'react'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
  value: number | null | undefined
  onChange: (value: number | null) => void
  min?: number
  max?: number
  decimals?: number
  allowEmpty?: boolean
  className?: string
}

/**
 * Champ numérique à saisie libre — remplace type="number" pour éliminer
 * les flèches du navigateur et permettre la frappe directe (virgule ou point).
 * La valeur numérique est émise au blur ; pendant la frappe, le texte brut
 * est conservé pour ne pas gêner la saisie intermédiaire ("1.", "0,5", etc.).
 */
export function NumericInput({
  value,
  onChange,
  min,
  max,
  decimals,
  allowEmpty = true,
  className,
  onBlur,
  onFocus,
  ...rest
}: NumericInputProps) {
  const [raw, setRaw] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function formatForDisplay(v: number | null | undefined): string {
    if (v == null || isNaN(v as number)) return ''
    return String(v).replace('.', ',')
  }

  function parseRaw(s: string): number | null {
    const normalized = s.replace(',', '.').trim()
    if (normalized === '' || normalized === '-') return null
    const n = parseFloat(normalized)
    return isNaN(n) ? null : n
  }

  function clamp(n: number): number {
    let result = n
    if (min != null) result = Math.max(min, result)
    if (max != null) result = Math.min(max, result)
    if (decimals != null) result = parseFloat(result.toFixed(decimals))
    return result
  }

  const displayValue = raw !== null ? raw : formatForDisplay(value)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const s = e.target.value
    // Autoriser uniquement les caractères numériques valides en cours de frappe
    if (s === '' || s === '-' || /^-?\d*[.,]?\d*$/.test(s)) {
      setRaw(s)
      const n = parseRaw(s)
      if (n !== null) {
        onChange(clamp(n))
      } else if (allowEmpty && s === '') {
        onChange(null)
      }
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const n = parseRaw(raw ?? '')
    if (n !== null) {
      const clamped = clamp(n)
      onChange(clamped)
      setRaw(formatForDisplay(clamped))
    } else {
      if (allowEmpty) {
        onChange(null)
        setRaw('')
      } else if (value != null) {
        setRaw(formatForDisplay(value))
      }
    }
    onBlur?.(e)
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    // Sélectionner tout au focus pour faciliter la réécriture
    inputRef.current?.select()
    if (raw === null) setRaw(formatForDisplay(value))
    onFocus?.(e)
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={className}
      {...rest}
    />
  )
}
