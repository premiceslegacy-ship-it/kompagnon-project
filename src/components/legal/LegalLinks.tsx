import Link from 'next/link'
import clsx from 'clsx'
import { LEGAL_PATHS } from '@/lib/legal'

type Props = {
  tone?: 'light' | 'dark'
  className?: string
}

export function LegalLinks({ tone = 'light', className }: Props) {
  const linkClassName =
    tone === 'dark'
      ? 'text-white/35 hover:text-white'
      : 'text-secondary hover:text-primary'

  return (
    <nav
      aria-label="Liens légaux"
      className={clsx('flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs', className)}
    >
      <Link href={LEGAL_PATHS.privacy} className={clsx('transition-colors', linkClassName)}>
        Confidentialité
      </Link>
      <Link href={LEGAL_PATHS.terms} className={clsx('transition-colors', linkClassName)}>
        Conditions
      </Link>
      <Link href={LEGAL_PATHS.legal} className={clsx('transition-colors', linkClassName)}>
        Mentions légales
      </Link>
    </nav>
  )
}
