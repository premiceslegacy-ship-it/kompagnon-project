// @atelier-migrated
'use client'

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { otpCells, otpComplete, otpDigits } from '@/lib/auth-ui'
import styles from './Auth.module.css'

/** Groupe de champs en liste, comme les Réglages. */
export function AuthFields({ children }: { children: ReactNode }) {
  return <div className={styles.list}>{children}</div>
}

export function AuthError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p className={styles.error} role="alert">
      {children}
    </p>
  )
}

export function AuthNotice({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function AuthNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>
}

export function AuthFine({ children }: { children: ReactNode }) {
  return <p className={styles.fine}>{children}</p>
}

export function AuthFooterLine({ children }: { children: ReactNode }) {
  return <p className={styles.footer}>{children}</p>
}

export function AuthSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      {title && <h2 className={styles.sectionTitle}>{title}</h2>}
      {children}
    </section>
  )
}

export function AuthSuccessMark() {
  return (
    <div className={styles.big} aria-hidden="true">
      <Check size={32} strokeWidth={2.5} />
    </div>
  )
}

/** Lien d'action discret (texte accent). */
export function AuthLink({ href, quiet = false, children }: { href: string; quiet?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={styles.link} data-quiet={quiet || undefined}>
      {children}
    </Link>
  )
}

export function AuthLinkButton({
  quiet = false,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'className'> & { quiet?: boolean }) {
  return (
    <button type="button" {...props} className={styles.link} data-quiet={quiet || undefined}>
      {children}
    </button>
  )
}

export function AuthAside({ children }: { children: ReactNode }) {
  return <div className={styles.aside}>{children}</div>
}

export function AuthCenter({ children }: { children: ReactNode }) {
  return <div className={styles.center}>{children}</div>
}

/** Bouton plein d'un formulaire serveur : se met en attente pendant l'envoi. */
export function AuthSubmit({
  children,
  pendingLabel,
  disabled,
  pending,
  name,
  value,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary'
  /** Avancer dans un parcours sans envoyer de formulaire. */
  onClick?: () => void
  pendingLabel?: string
  disabled?: boolean
  /** Envoie une valeur avec le formulaire (ex : destination choisie). */
  name?: string
  value?: string
  /** Attente pilotée à la main (formulaire sans useFormStatus). */
  pending?: boolean
}) {
  const status = useFormStatus()
  const loading = pending ?? status.pending
  return (
    <Button type={onClick ? 'button' : 'submit'} onClick={onClick} variant={variant} size="lg" className={styles.submit} loading={loading} loadingText={pendingLabel} aria-disabled={disabled ? true : undefined} name={name} value={value}>
      {children}
    </Button>
  )
}

/** Mot de passe avec bouton « Afficher ». Se lit par FormData : `name` obligatoire. */
export function PasswordField({
  label,
  hint,
  error,
  ...props
}: {
  label: string
  hint?: string
  error?: string
} & Omit<ComponentProps<'input'>, 'type' | 'className' | 'id'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className={styles.passwordWrap}>
      <Field
        {...props}
        type="text"
        inputType={shown ? 'text' : 'password'}
        label={label}
        hint={hint}
        error={error}
        controlClassName={styles.passwordControl}
      />
      <button
        type="button"
        className={styles.show}
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      >
        {shown ? 'Masquer' : 'Afficher'}
      </button>
    </div>
  )
}

/**
 * Code à six chiffres : un seul champ réel (`name`, lisible par FormData, rempli
 * automatiquement par le clavier iOS/Android) sous six cases d'affichage.
 * Le formulaire part dès que les six chiffres sont saisis.
 */
export function OtpInput({
  name = 'token',
  value,
  onChange,
  autoSubmit = true,
}: {
  name?: string
  value: string
  onChange: (next: string) => void
  autoSubmit?: boolean
}) {
  const id = useId()
  const { pending: busy } = useFormStatus()
  const ref = useRef<HTMLInputElement>(null)

  // Un code effacé (refus du serveur) redonne le focus pour ressaisir tout de suite.
  useEffect(() => {
    if (value === '') ref.current?.focus()
  }, [value])
  return (
    <div className={styles.otp}>
      <input
        ref={ref}
        id={id}
        className={styles.otpInput}
        name={name}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={12}
        autoFocus
        readOnly={busy}
        aria-label="Code à 6 chiffres"
        onChange={(event) => {
          const next = otpDigits(event.target.value)
          onChange(next)
          if (autoSubmit && otpComplete(next)) {
            const form = event.target.form
            // Laisse React afficher la sixième case avant l'envoi.
            if (form) window.setTimeout(() => form.requestSubmit(), 0)
          }
        }}
      />
      <div className={styles.cells} data-busy={busy || undefined} aria-hidden="true">
        {otpCells(value).map((cell, index) => (
          <span key={index} className={styles.cell} data-current={cell.current || undefined} data-filled={cell.filled || undefined}>
            {cell.char}
          </span>
        ))}
      </div>
    </div>
  )
}

export function OtpHelp({ children }: { children: ReactNode }) {
  return <p className={styles.otpHelp}>{children}</p>
}

export function PasswordRule({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <p className={styles.rule} data-met={met}>
      <Check size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** Action discrète d'un formulaire serveur (ex : exporter ses données). */
export function AuthTextSubmit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={styles.link} data-quiet="true" disabled={pending}>
      {children}
    </button>
  )
}
