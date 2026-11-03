'use client'

import { useCallback, useState, type CSSProperties } from 'react'
import styles from './Avatar.module.css'

type AvatarProps = {
  name: string
  src?: string
  alt?: string
  size?: number
  className?: string
}

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase('fr-FR')
}

function AvatarImage({ src, name }: { src: string; name: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  // Image events may finish before React hydrates the server-rendered element.
  const inspectCompletedImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) setStatus(image.naturalWidth > 0 ? 'ready' : 'failed')
  }, [])

  return (
    <>
      {status !== 'ready' && <span className={styles.fallback}>{initialsFor(name)}</span>}
      {status !== 'failed' && (
        <img
          ref={inspectCompletedImage}
          className={styles.image}
          src={src}
          alt=""
          aria-hidden="true"
          hidden={status !== 'ready'}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('failed')}
        />
      )}
    </>
  )
}

/** A 34px circular avatar with initials as a useful image fallback. */
export function Avatar({ name, src, alt, size = 34, className }: AvatarProps) {
  const label = alt?.trim() || name.trim()
  const rootClassName = className ? `${styles.avatar} ${className}` : styles.avatar
  const style: CSSProperties = { width: size, height: size }

  return (
    <span className={rootClassName} style={style} role="img" aria-label={label}>
      {src ? <AvatarImage key={src} src={src} name={name} /> : <span className={styles.fallback}>{initialsFor(name)}</span>}
    </span>
  )
}
