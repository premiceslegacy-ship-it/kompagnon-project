'use client'

import { useEffect, useState } from 'react'
import { displayUnitToMeters, metersToDisplayUnit, type DimensionDisplayUnit } from '@/lib/catalog-pricing'
import { Field } from '@/components/ui/Field'
import { formatDimensionInputValue, parseDimensionInputValue } from './helpers'

/** Saisie d'une cote dans l'unité affichée ; la valeur remonte en mètres. */
export function DimensionInput({
  label,
  valueM,
  fallbackM,
  unit,
  onValueM,
}: {
  label: string
  valueM: number | null | undefined
  fallbackM: number | null | undefined
  unit: DimensionDisplayUnit
  onValueM: (value: number | null) => void
}) {
  const displayValue = formatDimensionInputValue(metersToDisplayUnit(valueM ?? fallbackM ?? null, unit))
  const [draft, setDraft] = useState(displayValue)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(displayValue)
  }, [displayValue, focused])

  return (
    <Field
      type="text"
      label={`${label} (${unit})`}
      inputMode="decimal"
      pattern="[0-9]*[,.]?[0-9]*"
      value={focused ? draft : displayValue}
      placeholder="0"
      onFocus={() => {
        setFocused(true)
        setDraft(displayValue)
      }}
      onBlur={() => {
        setFocused(false)
        setDraft(displayValue)
      }}
      onChange={e => {
        const next = e.currentTarget.value
        const parsed = parseDimensionInputValue(next)
        if (parsed === undefined) return
        setDraft(next)
        onValueM(parsed == null ? null : displayUnitToMeters(parsed, unit))
      }}
    />
  )
}
