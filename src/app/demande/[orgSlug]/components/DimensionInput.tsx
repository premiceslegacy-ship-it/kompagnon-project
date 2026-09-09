'use client'

import { useEffect, useState } from 'react'
import { displayUnitToMeters, metersToDisplayUnit, type DimensionDisplayUnit } from '@/lib/catalog-pricing'
import { formatDimensionInputValue, parseDimensionInputValue } from './helpers'

export function DimensionInput({
  valueM,
  fallbackM,
  unit,
  placeholder,
  className,
  onValueM,
}: {
  valueM: number | null | undefined
  fallbackM: number | null | undefined
  unit: DimensionDisplayUnit
  placeholder?: string
  className: string
  onValueM: (value: number | null) => void
}) {
  const displayValue = formatDimensionInputValue(metersToDisplayUnit(valueM ?? fallbackM ?? null, unit))
  const [draft, setDraft] = useState(displayValue)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(displayValue)
  }, [displayValue, focused])

  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9]*[,.]?[0-9]*"
      value={focused ? draft : displayValue}
      placeholder={placeholder}
      onFocus={() => {
        setFocused(true)
        setDraft(displayValue)
      }}
      onBlur={() => {
        setFocused(false)
        setDraft(displayValue)
      }}
      onChange={e => {
        const next = e.target.value
        const parsed = parseDimensionInputValue(next)
        if (parsed === undefined) return
        setDraft(next)
        onValueM(parsed == null ? null : displayUnitToMeters(parsed, unit))
      }}
      className={className}
    />
  )
}
