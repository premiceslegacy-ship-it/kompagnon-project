'use client'

import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import styles from './SegmentedControl.module.css'

export type SegmentedControlOption = {
  value: string
  label: string
  disabled?: boolean
}

export type SegmentedControlProps = {
  options: readonly SegmentedControlOption[]
  value: string
  onChange: (value: string) => void
  label: string
  name?: string
  disabled?: boolean
  loading?: boolean
  error?: string
  fullWidth?: boolean
}

/** Sélection exclusive native au clavier, présentée comme un contrôle segmenté. */
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  name,
  disabled = false,
  loading = false,
  error,
  fullWidth = false,
}: SegmentedControlProps) {
  const generatedId = useId()
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const choicesRef = useRef<HTMLDivElement>(null)
  const previousValueRef = useRef(value)
  const inputName = name ?? generatedId
  const idPrefix = generatedId.replaceAll(':', '')
  const errorId = `${idPrefix}-error`
  const isDisabled = disabled || loading

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const choices = choicesRef.current
    if (!scroller || !choices) return
    let lastX = -1
    let lastWidth = -1
    let lastViewportWidth = -1

    const measure = (smooth: boolean, resized = false) => {
      const input = choices.querySelector<HTMLInputElement>('input:checked')
      const option = input?.closest('label')
      const visual = input?.nextElementSibling
      if (!input || !option || !(visual instanceof HTMLElement)) {
        choices.style.setProperty('--seg-thumb-w', '0px')
        choices.setAttribute('data-thumb-ready', '')
        return
      }
      const x = option.offsetLeft + visual.offsetLeft
      const width = visual.offsetWidth
      if (resized && x === lastX && width === lastWidth && scroller.clientWidth === lastViewportWidth) return
      lastX = x
      lastWidth = width
      lastViewportWidth = scroller.clientWidth
      choices.style.setProperty('--seg-thumb-x', `${x}px`)
      choices.style.setProperty('--seg-thumb-w', `${width}px`)
      choices.setAttribute('data-thumb-ready', '')
      choices.toggleAttribute('data-thumb-disabled', input.matches(':disabled'))

      const visible = scroller.getBoundingClientRect()
      const selected = visual.getBoundingClientRect()
      let left = scroller.scrollLeft
      if (selected.left < visible.left + 4) left = Math.max(0, Math.floor(left + selected.left - visible.left - 4))
      else if (selected.right > visible.right - 4) left = Math.ceil(left + selected.right - visible.right + 4)
      if (left !== scroller.scrollLeft && typeof scroller.scrollTo === 'function') {
        const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
        scroller.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' })
      }
    }

    measure(previousValueRef.current !== value)
    previousValueRef.current = value
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure(false, true))
    observer.observe(scroller)
    choices.querySelectorAll<HTMLElement>(`.${styles.optionVisual}`).forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [value, options, isDisabled])

  function moveSelection(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(key)) return

    const radios = Array.from(
      fieldsetRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)') ?? [],
    )
    if (radios.length === 0) return

    event.preventDefault()
    const currentIndex = radios.indexOf(event.currentTarget)
    let nextIndex = currentIndex

    if (key === 'Home') {
      nextIndex = 0
    } else if (key === 'End') {
      nextIndex = radios.length - 1
    } else if (key === 'ArrowRight' || key === 'ArrowDown') {
      nextIndex = (currentIndex + 1 + radios.length) % radios.length
    } else {
      nextIndex = (currentIndex - 1 + radios.length) % radios.length
    }

    const nextRadio = radios[nextIndex]
    nextRadio.focus({ preventScroll: true })
    nextRadio.click()
  }

  return (
    <div className={`${styles.root}${fullWidth ? ` ${styles.fullWidth}` : ''}`}>
      <fieldset
        ref={fieldsetRef}
        role="radiogroup"
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={styles.group}
      >
        <legend className={styles.visuallyHidden}>{label}</legend>
        <div ref={scrollerRef} className={styles.scroller}>
        <div ref={choicesRef} className={styles.choices}>
          <span className={styles.track} aria-hidden="true" />
          <span className={styles.thumb} aria-hidden="true" />
          {options.map((option, index) => {
            const inputId = `${idPrefix}-option-${index}`
            return (
              <label className={styles.option} htmlFor={inputId} key={option.value}>
                <input
                  id={inputId}
                  type="radio"
                  name={inputName}
                  value={option.value}
                  checked={value === option.value}
                  disabled={option.disabled}
                  aria-describedby={error ? errorId : undefined}
                  onChange={() => onChange(option.value)}
                  onKeyDown={moveSelection}
                />
                <span className={styles.optionVisual}>{option.label}</span>
              </label>
            )
          })}
        </div>
        </div>
      </fieldset>
      {loading && (
        <span className={styles.visuallyHidden} role="status">
          Chargement
        </span>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
