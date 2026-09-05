/**
 * Illustrations maison, même esprit que app/components/AtelierIcons.tsx sur la landing
 * page (repo atelierbyorsayn) : un seul trait, coins arrondis, un unique accent orange
 * par icône — pas de fond, pas de forme pleine, pas d'icône stock. Trait éclairci pour
 * rester lisible sur le fond sombre de l'onboarding (la LP est en clair, encre sombre).
 */
import type { ReactNode } from 'react'

const STROKE = 'rgba(255,255,255,0.82)'
const ACCENT = '#ff9f1c'

/**
 * Cadre à relief physique — transposition sombre de .bento-card__icon (styles.css,
 * repo atelierbyorsayn) : dégradé + double ombre (highlight interne, ombre dure vers
 * le noir) au lieu du halo plat bg-accent/10 générique utilisé jusqu'ici.
 */
export function IconFrame({ children, size = 'md' }: { children: ReactNode; size?: 'md' | 'lg' }) {
  const frameSize = size === 'lg' ? 'w-16 h-16 rounded-[22px]' : 'w-11 h-11 rounded-2xl'
  const iconSize = size === 'lg' ? 'w-8 h-8' : 'w-6 h-6'
  const inset = size === 'lg' ? 6 : 4
  return (
    <div
      className={`relative shrink-0 grid place-items-center ${frameSize}`}
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.35), 0 3px 0 rgba(0,0,0,0.45), 0 10px 22px rgba(0,0,0,0.3)',
      }}
    >
      <div
        className="absolute rounded-xl pointer-events-none"
        style={{ inset, border: '1px solid rgba(255,255,255,0.06)' }}
        aria-hidden="true"
      />
      <span className={`relative ${iconSize}`}>{children}</span>
    </div>
  )
}

export function IconBienvenue({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6.5 L38 12v11c0 10-6 15.8-14 18.5C16 39.3 10 33.5 10 23V12Z" stroke={STROKE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17.5 23.5 L22 28 L31 17.5" stroke={ACCENT} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconEntreprise({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M10 41 V13 L24 6 L38 13 V41" stroke={STROKE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6 41 h36" stroke={STROKE} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18 41 v-9 h12 v9" stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M17 20 h4 M27 20 h4 M17 27 h4 M27 27 h4" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function IconCoordonnees({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 5 c7.5 0 13 5.8 13 13 0 9.5-9 17-13 25 -4-8-13-15.5-13-25 0-7.2 5.5-13 13-13Z" stroke={STROKE} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="24" cy="18.2" r="4.6" stroke={ACCENT} strokeWidth="2.1" />
    </svg>
  )
}

export function IconConformite({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6.5 L38 12v11c0 10-6 15.8-14 18.5C16 39.3 10 33.5 10 23V12Z" stroke={STROKE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17.5 23.5 L22 28 L31 17.5" stroke={ACCENT} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconEquipe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="17.5" cy="18" r="6" stroke={STROKE} strokeWidth="1.6" />
      <path d="M7 37c1-7 5-10.5 10.5-10.5S27 30 28 37" stroke={STROKE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="20.5" r="4.8" stroke={STROKE} strokeWidth="1.5" />
      <path d="M25.5 37c.8-5.6 4-8.6 8-8.6 3.7 0 6.8 2.6 7.9 7.3" stroke={ACCENT} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCode({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="8" y="10" width="32" height="28" rx="3" stroke={STROKE} strokeWidth="1.6" />
      <path d="M8 18 h32" stroke={STROKE} strokeWidth="1.4" />
      <circle cx="13.5" cy="14" r="1.3" fill={STROKE} />
      <circle cx="18" cy="14" r="1.3" fill={STROKE} />
      <path d="M18 27 l4 4 -4 4 M26 35 l4 -8" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
