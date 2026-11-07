'use client'
// @atelier-migrated

import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { formatAddress, getMapsDirectionsUrl, type AddressParts } from '@/lib/address'
import styles from './AddressLink.module.css'

type AddressLinkProps = AddressParts & {
  className?: string
  textClassName?: string
  iconClassName?: string
  showCopy?: boolean
  copyLabel?: string
}

export function AddressLink({
  className = '',
  textClassName = '',
  iconClassName = '',
  showCopy = false,
  copyLabel = 'Copier',
  ...parts
}: AddressLinkProps) {
  const address = formatAddress(parts)
  const [copied, setCopied] = useState(false)

  if (!address) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // No-op: on garde l'action principale même si le presse-papiers échoue.
    }
  }

  return (
    <div className={`${styles.row} ${className}`}>
      <MapPin className={`${styles.icon} ${iconClassName}`} size={16} aria-hidden="true" />
      <div className={styles.body}>
        <a
          href={getMapsDirectionsUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.link} ${textClassName}`}
          title={`Ouvrir l’itinéraire vers ${address}`}
        >
          <span className={styles.text}>{address}</span>
        </a>
        {showCopy && (
          <button type="button" onClick={handleCopy} className={styles.copy}>
            {copied ? 'Adresse copiée' : copyLabel}
          </button>
        )}
      </div>
    </div>
  )
}
