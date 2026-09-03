/**
 * Icônes maison, style feutre : un seul trait (currentColor), coins arrondis,
 * un accent ambre par icône. Pas de fond, pas de forme pleine, pas de halo —
 * le dessin seul, comme un croquis technique. Portées depuis la landing page
 * (atelier-lp-code/app/components/AtelierIcons.tsx), adaptées theme-aware.
 */

const ACCENT = 'rgb(var(--accent-primary))'

export type AtelierIconProps = { className?: string }

export function IconDevis({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M13 5 h16 l7 7 v29 a2 2 0 0 1 -2 2 h-21 a2 2 0 0 1 -2 -2 v-34 a2 2 0 0 1 2 -2 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M29 5 v7 h7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15 24 h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15 30 h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15 36 h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16 15.5 L19.5 19 L26 12" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconRelance({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 8c-6.6 0-11 4.9-11 11v8.5l-3.4 5.3c-.5.8.1 1.7 1 1.7h26.8c.9 0 1.5-.9 1-1.7L35 27.5V19c0-6.1-4.4-11-11-11Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20 36.5a4 4 0 0 0 8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M35.5 8.5 c2.2 1.6 3.4 3.6 3.6 6.3" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <circle cx="36" cy="10" r="2" fill={ACCENT} />
    </svg>
  )
}

export function IconPointage({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="26" r="15.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M24 17.5 v9 l6.5 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 6.5 h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M39 12 l2.4 -2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M24 10.5 v2.2" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}

export function IconMarge({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M6 40 h36" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 40 v-11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22 40 v-18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M32 40 v-25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 27 L18 18 L24 22.5 L37 9" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 9 h7 v7" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCalendrier({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="7" y="10" width="34" height="30" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 18 h34" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 6.5 v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M33 6.5 v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="14" y="24" width="6" height="6" rx="1.4" stroke={ACCENT} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M27 27 h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M27 33 h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconConformite({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6.5 L38 12v11c0 10-6 15.8-14 18.5C16 39.3 10 33.5 10 23V12Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17.5 23.5 L22 28 L31 17.5" stroke={ACCENT} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconChantier({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* Casque de chantier, vue de face */}
      <path d="M9 32 C9 19.5 15.7 10 24 10 C32.3 10 39 19.5 39 32" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.5 32 h35" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M24 12 v20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13 32 c0 -9.5 4.9 -17.3 11 -19.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M17 32.5 h14" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconTresorerie({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="6" y="14" width="36" height="22" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 20 h36" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="24" cy="27.5" r="4.6" stroke={ACCENT} strokeWidth="1.9" />
      <path d="M12 30 h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconVoix({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="18" y="6" width="12" height="22" rx="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 22c0 7 5.4 12.5 12 12.5S36 29 36 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M24 34.5 v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 41.5 h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M23 11 v10" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}

export function IconPropose({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 6 v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M24 30 v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17.5 42 h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.5 24 c0 -5.2 4.2 -9.5 9.5 -9.5 s9.5 4.3 9.5 9.5 c0 4 -2.4 6 -3.8 8.2 -1 1.6 -1.4 2.7 -1.4 4.2 h-8.6 c0 -1.5 -.4 -2.6 -1.4 -4.2 -1.4 -2.2 -3.8 -4.2 -3.8 -8.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 18 l4.4 2.4" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <path d="M39 18 l-4.4 2.4" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function IconApprend({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M9 24a15 15 0 0 1 25.6 -10.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M39 24a15 15 0 0 1 -25.6 10.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M34.6 7.5 v6.4 h-6.4" stroke={ACCENT} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.4 40.5 v-6.4 h6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconEquipe({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="17.5" cy="18" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 37c1-7 5-10.5 10.5-10.5S27 30 28 37" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="20.5" r="4.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M25.5 37c.8-5.6 4-8.6 8-8.6 3.7 0 6.8 2.6 7.9 7.3" stroke={ACCENT} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─── Icônes de navigation (nouvelles, même langage) ─── */

export function IconAccueil({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M8 22 L24 8 L40 22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 19 v19 a2 2 0 0 0 2 2 h20 a2 2 0 0 0 2 -2 v-19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M19 40 v-11 h10 v11" stroke={ACCENT} strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClient({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="17" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 40c1.4-9 7-13.5 15-13.5S37 31 38.5 40" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 16.5 L22 21 L31 11.5" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCatalogue({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="7" y="8" width="34" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7" y="20" width="34" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7" y="32" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M28 32.5 L32 36.5 L40 28.5" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconReglages({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* Curseurs de réglage, trois glissières à hauteurs différentes */}
      <path d="M7 13 h34" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 24 h34" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 35 h34" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17" cy="13" r="3.4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="31" cy="24" r="3.4" fill={ACCENT} stroke={ACCENT} strokeWidth="1.6" />
      <circle cx="20" cy="35" r="3.4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function IconMenu({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M8 14 h32" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 24 h22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 34 h32" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconAjouter({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="16.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M24 16 v16 M16 24 h16" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconNotification({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 8c-6.6 0-11 4.9-11 11v8.5l-3.4 5.3c-.5.8.1 1.7 1 1.7h26.8c.9 0 1.5-.9 1-1.7L35 27.5V19c0-6.1-4.4-11-11-11Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20 36.5a4 4 0 0 0 8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="35" cy="11" r="5" fill={ACCENT} />
    </svg>
  )
}

export function IconRapport({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="9" y="6" width="30" height="36" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 30 v-8 M23 30 v-14 M31 30 v-5" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" />
      <path d="M15 36 h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconRecherche({ className }: AtelierIconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="21" cy="21" r="12.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M30 30 L40.5 40.5" stroke={ACCENT} strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}
