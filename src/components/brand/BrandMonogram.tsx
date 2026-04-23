import { APP_NAME, monogramForTheme, type BrandBackground } from '@/lib/brand'

export function BrandMonogram({
  background,
  className = '',
  alt = APP_NAME,
}: {
  background: BrandBackground
  className?: string
  alt?: string
}) {
  return (
    <img
      src={monogramForTheme(background)}
      alt={alt}
      className={className}
      draggable={false}
    />
  )
}

export function BrandWordmark({
  background,
  className = '',
  alt = APP_NAME,
}: {
  background: BrandBackground
  className?: string
  alt?: string
}) {
  const src = background === 'dark'
    ? '/brand/atelier/logo-atelier-blanc.svg'
    : '/brand/atelier/logo-atelier-noir.svg'

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
    />
  )
}
