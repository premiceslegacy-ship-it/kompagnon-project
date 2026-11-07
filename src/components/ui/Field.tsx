'use client'

import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { NumericInput } from './NumericInput'
import styles from './Field.module.css'

type FieldSharedProps = {
  label: string
  hint?: string
  error?: string
  loading?: boolean
  disabled?: boolean
  id?: string
  className?: string
  controlClassName?: string
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
}

type InputNativeProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id' | 'className' | 'disabled' | 'aria-describedby' | 'aria-invalid'
>

type SelectNativeProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'className' | 'disabled' | 'aria-describedby' | 'aria-invalid' | 'children'
>

type TextareaNativeProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'className' | 'disabled' | 'aria-describedby' | 'aria-invalid'
>

/** Champs saisis au clavier ; `date` et `time` gardent le sélecteur natif du système. */
export type FieldTextType = 'text' | 'email' | 'tel' | 'date' | 'time'

export type FieldTextProps = FieldSharedProps & InputNativeProps & {
  type: FieldTextType
  /** Nature de la saisie quand `type` ne suffit pas : mot de passe, adresse web… */
  inputType?: 'text' | 'password' | 'email' | 'tel' | 'url' | 'date' | 'time'
}

export type FieldNumberProps = FieldSharedProps & Omit<
  InputNativeProps,
  'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
> & {
  type: 'number'
  value: number | null | undefined
  onChange: (value: number | null) => void
  min?: number
  max?: number
  decimals?: number
  allowEmpty?: boolean
}

export type FieldSelectProps = FieldSharedProps & SelectNativeProps & {
  type: 'select'
  children: React.ReactNode
}

export type FieldTextareaProps = FieldSharedProps & TextareaNativeProps & {
  type: 'textarea'
}

export type FieldProps = FieldTextProps | FieldNumberProps | FieldSelectProps | FieldTextareaProps

type InlineMetrics = {
  font: string
  letterSpacing: number
  labelWidth: number
  gap: number
}

let measurementContext: CanvasRenderingContext2D | null | undefined

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext !== undefined) return measurementContext
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  measurementContext = canvas.getContext('2d')
  return measurementContext
}

function measureTextWidth(text: string, font: string, letterSpacing: number): number | null {
  if (!text) return 0
  const context = getMeasurementContext()
  if (!context) return null

  context.font = font
  return context.measureText(text).width + letterSpacing * Math.max(0, text.length - 1)
}

function joinClasses(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}

export function Field(props: FieldProps) {
  const generatedId = useId()
  const controlId = props.id ?? `field-${generatedId}`
  const errorId = `${controlId}-error`
  const hintId = `${controlId}-hint`
  const rowRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLLabelElement>(null)
  const [stacked, setStacked] = useState(false)
  const [measureRevision, setMeasureRevision] = useState(0)
  const inlineMetrics = useRef<InlineMetrics | null>(null)

  const label = props.label
  const type = props.type
  const measureStacking = useCallback(() => {
    if (type === 'textarea') return

    const row = rowRef.current
    const labelElement = labelRef.current
    const control = row?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null
    if (!row || !labelElement || !control || row.clientWidth === 0) return

    const rowStyle = window.getComputedStyle(row)
    const contentWidth = row.clientWidth
      - Number.parseFloat(rowStyle.paddingLeft || '0')
      - Number.parseFloat(rowStyle.paddingRight || '0')
    let metrics = inlineMetrics.current
    if (!row.classList.contains(styles.stacked)) {
      const labelStyle = window.getComputedStyle(labelElement)
      if (labelElement.clientWidth === 0) return
      if (!metrics) {
        metrics = { font: '', letterSpacing: 0, labelWidth: 0, gap: 0 }
        inlineMetrics.current = metrics
      }
      metrics.font = `${labelStyle.fontStyle} ${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`
      metrics.letterSpacing = Number.parseFloat(labelStyle.letterSpacing) || 0
      metrics.labelWidth = labelElement.clientWidth
      metrics.gap = Number.parseFloat(rowStyle.columnGap) || 0
    }
    if (!metrics) return
    const labelTextWidth = measureTextWidth(label, metrics.font, metrics.letterSpacing)
    if (labelTextWidth === null) return

    let controlText: string
    if (control instanceof HTMLSelectElement) {
      controlText = control.selectedOptions[0]?.textContent ?? ''
    } else {
      controlText = control.value || control.placeholder
    }

    const controlStyle = window.getComputedStyle(control)
    const inlineControlWidth = contentWidth - metrics.labelWidth - metrics.gap
      - Number.parseFloat(controlStyle.paddingLeft || '0')
      - Number.parseFloat(controlStyle.paddingRight || '0')
    const controlFont = `${controlStyle.fontStyle} ${controlStyle.fontWeight} ${controlStyle.fontSize} ${controlStyle.fontFamily}`
    const controlTextWidth = measureTextWidth(controlText, controlFont, Number.parseFloat(controlStyle.letterSpacing) || 0)
    if (controlTextWidth === null) return

    setStacked(labelTextWidth > metrics.labelWidth || controlTextWidth > inlineControlWidth || inlineControlWidth <= 0)
  }, [label, type])

  useLayoutEffect(() => {
    if (type === 'textarea') return

    const row = rowRef.current
    if (!row) return

    let active = true
    measureStacking()
    void document.fonts?.ready.then(() => {
      if (active) measureStacking()
    })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureStacking)
    if (observer) observer.observe(row)
    else window.addEventListener('resize', measureStacking)
    return () => {
      active = false
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', measureStacking)
    }
  }, [measureStacking, type])

  const displayedValue = props.type !== 'textarea' ? props.value : undefined
  const displayedPlaceholder = props.type !== 'textarea' && props.type !== 'select'
    ? props.placeholder
    : undefined
  const selectedChildren = props.type === 'select' ? props.children : undefined

  useLayoutEffect(() => {
    measureStacking()
  }, [displayedValue, displayedPlaceholder, selectedChildren, props.className, props.controlClassName, props.style, measureRevision, measureStacking])

  const isDisabled = Boolean(props.disabled || props.loading)
  const describedBy = [
    props['aria-describedby'],
    props.error != null ? errorId : undefined,
    props.hint != null ? hintId : undefined,
  ].filter(Boolean).join(' ') || undefined
  const controlA11yProps = {
    id: controlId,
    disabled: isDisabled,
    'aria-invalid': props.error != null ? true : props['aria-invalid'],
    'aria-describedby': describedBy,
  }
  const rowClassName = type === 'textarea'
    ? styles.textareaRow
    : joinClasses(styles.row, stacked ? styles.stacked : undefined)
  const rootClassName = joinClasses(styles.field, props.className)

  function renderField(control: React.ReactNode) {
    return (
      <div className={rootClassName} aria-busy={props.loading || undefined} data-disabled={isDisabled || undefined}>
        <div ref={type === 'textarea' ? undefined : rowRef} className={rowClassName}>
          <label ref={labelRef} className={joinClasses(styles.label, type === 'textarea' || stacked ? styles.stackedLabel : undefined)} htmlFor={controlId}>
            {label}
          </label>
          {control}
        </div>
        {props.error != null && (
          <p id={errorId} className={joinClasses(styles.message, styles.error)} aria-live="polite">
            {props.error}
          </p>
        )}
        {props.hint != null && (
          <p id={hintId} className={styles.message}>
            {props.hint}
          </p>
        )}
      </div>
    )
  }

  if (props.type === 'number') {
    const {
      type: _type,
      label: _label,
      hint: _hint,
      error: _error,
      loading: _loading,
      disabled: _disabled,
      id: _id,
      className: _className,
      controlClassName: _controlClassName,
      'aria-describedby': _ariaDescribedBy,
      'aria-invalid': _ariaInvalid,
      value,
      onChange,
      onInput,
      min,
      max,
      decimals,
      allowEmpty,
      ...nativeProps
    } = props

    return renderField(
      <span className={styles.numberControl}>
        <NumericInput
          {...nativeProps}
          {...controlA11yProps}
          value={value}
          onChange={onChange}
          onInput={(event) => {
            onInput?.(event)
            setMeasureRevision((revision) => revision + 1)
          }}
          min={min}
          max={max}
          decimals={decimals}
          allowEmpty={allowEmpty}
          className={joinClasses(styles.control, props.controlClassName)}
        />
      </span>,
    )
  }

  if (props.type === 'text' || props.type === 'email' || props.type === 'tel' || props.type === 'date' || props.type === 'time') {
    const {
      type: fieldType,
      label: _label,
      hint: _hint,
      error: _error,
      loading: _loading,
      disabled: _disabled,
      id: _id,
      className: _className,
      controlClassName: _controlClassName,
      'aria-describedby': _ariaDescribedBy,
      'aria-invalid': _ariaInvalid,
      inputType,
      onChange,
      onInput,
      ...nativeProps
    } = props

    return renderField(
      <input
        {...nativeProps}
        {...controlA11yProps}
        type={inputType ?? fieldType}
        onChange={(event) => {
          onChange?.(event)
          setMeasureRevision((revision) => revision + 1)
        }}
        onInput={(event) => onInput?.(event)}
        className={joinClasses(styles.control, props.controlClassName)}
      />,
    )
  }

  if (props.type === 'select') {
    const {
      type: _type,
      label: _label,
      hint: _hint,
      error: _error,
      loading: _loading,
      disabled: _disabled,
      id: _id,
      className: _className,
      controlClassName: _controlClassName,
      'aria-describedby': _ariaDescribedBy,
      'aria-invalid': _ariaInvalid,
      onChange,
      children,
      ...nativeProps
    } = props

    return renderField(
      <select
        {...nativeProps}
        {...controlA11yProps}
        onChange={(event) => {
          onChange?.(event)
          setMeasureRevision((revision) => revision + 1)
        }}
        className={joinClasses(styles.control, styles.selectControl, props.controlClassName)}
      >
        {children}
      </select>,
    )
  }

  // Seul le type textarea atteint ce point : les autres types ont déjà rendu leur champ.
  const textareaProps = props as FieldTextareaProps
  const {
    type: _type,
    label: _label,
    hint: _hint,
    error: _error,
    loading: _loading,
    disabled: _disabled,
    id: _id,
    className: _className,
    controlClassName: _controlClassName,
    'aria-describedby': _ariaDescribedBy,
    'aria-invalid': _ariaInvalid,
    onInput,
    ...nativeProps
  } = textareaProps

  return renderField(
    <textarea
      {...nativeProps}
      {...controlA11yProps}
      onInput={(event) => onInput?.(event)}
      className={joinClasses(styles.textarea, props.controlClassName)}
    />,
  )
}
