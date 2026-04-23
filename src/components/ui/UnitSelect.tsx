'use client'

import React, { useState, useEffect, useRef } from 'react'
import { getUnitGroups, isBuiltInUnit } from '@/lib/units'

type UnitSelectProps = {
  value: string | null | undefined
  onChange: (unit: string) => void
  className?: string
  disabled?: boolean
  compact?: boolean
  allowedUnits?: string[] | null
}

const OTHER_VALUE = '__other__'

export function UnitSelect({
  value,
  onChange,
  className = '',
  disabled = false,
  compact = false,
  allowedUnits,
}: UnitSelectProps) {
  const isOther = value ? !isBuiltInUnit(value) : false
  const [showFreeInput, setShowFreeInput] = useState(isOther)
  const [freeInputValue, setFreeInputValue] = useState(isOther ? (value ?? '') : '')
  const freeInputRef = useRef<HTMLInputElement>(null)
  const unitGroups = getUnitGroups(allowedUnits)

  useEffect(() => {
    if (showFreeInput && freeInputRef.current) {
      freeInputRef.current.focus()
    }
  }, [showFreeInput])

  // Sync if parent changes value to a built-in
  useEffect(() => {
    if (value && isBuiltInUnit(value)) {
      setShowFreeInput(false)
    } else if (value && !isBuiltInUnit(value)) {
      setShowFreeInput(true)
      setFreeInputValue(value)
    }
  }, [value])

  const selectValue = showFreeInput ? OTHER_VALUE : (value ?? 'u')

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === OTHER_VALUE) {
      setShowFreeInput(true)
      setFreeInputValue('')
    } else {
      setShowFreeInput(false)
      onChange(e.target.value)
    }
  }

  function handleFreeInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFreeInputValue(e.target.value)
    onChange(e.target.value)
  }

  function handleFreeInputBlur() {
    if (!freeInputValue.trim()) {
      setShowFreeInput(false)
      onChange('u')
    }
  }

  function handleFreeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setShowFreeInput(false)
      onChange('u')
    }
  }

  const baseSelectCls = `bg-transparent border border-white/10 rounded-lg text-primary text-sm outline-none focus:border-accent transition-colors cursor-pointer ${compact ? 'px-1 py-1 text-xs' : 'px-2 py-1.5'} ${className}`
  const baseFreeInputCls = `bg-transparent border border-accent rounded-lg text-primary text-sm outline-none px-2 py-1.5 text-center ${compact ? 'text-xs w-16' : 'w-24'} ${className}`

  if (showFreeInput) {
    return (
      <input
        ref={freeInputRef}
        type="text"
        value={freeInputValue}
        onChange={handleFreeInputChange}
        onBlur={handleFreeInputBlur}
        onKeyDown={handleFreeInputKeyDown}
        placeholder="ex: m³/h"
        disabled={disabled}
        className={baseFreeInputCls}
      />
    )
  }

  return (
    <select
      value={selectValue}
      onChange={handleSelectChange}
      disabled={disabled}
      className={baseSelectCls}
    >
      {unitGroups.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.value}</option>
          ))}
        </optgroup>
      ))}
      <option value={OTHER_VALUE}>Autre…</option>
    </select>
  )
}
