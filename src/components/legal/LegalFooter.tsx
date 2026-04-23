import clsx from 'clsx'
import { APP_SIGNATURE } from '@/lib/brand'
import { LegalLinks } from './LegalLinks'

type Props = {
  tone?: 'light' | 'dark'
  className?: string
  caption?: string
}

export function LegalFooter({
  tone = 'light',
  className,
  caption = `© ${new Date().getFullYear()} ${APP_SIGNATURE}. Tous droits reserves.`,
}: Props) {
  const textClassName = tone === 'dark' ? 'text-white/20' : 'text-secondary'

  return (
    <div className={clsx('space-y-3 text-center', className)}>
      <p className={clsx('text-xs', textClassName)}>{caption}</p>
      <LegalLinks tone={tone} />
    </div>
  )
}
