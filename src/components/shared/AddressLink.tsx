'use client'

import React, { useState } from 'react'
import { Check, Copy, MapPin, Navigation2 } from 'lucide-react'
import { formatAddress, getMapsDirectionsUrl, type AddressParts } from '@/lib/address'

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
    <div className={`flex items-center gap-2 ${className}`}>
      <MapPin className={`w-4 h-4 mt-0.5 shrink-0 ${iconClassName}`} />
      <div className="min-w-0 flex-1">
        <a
          href={getMapsDirectionsUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 hover:text-accent transition-colors ${textClassName}`}
          title={`Ouvrir l'itinéraire vers ${address}`}
        >
          <span className="break-words">{address}</span>
          <Navigation2 className="w-3.5 h-3.5 shrink-0 opacity-70" />
        </a>
        {showCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="ml-2 inline-flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-accent transition-colors align-middle"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Adresse copiée' : copyLabel}
          </button>
        )}
      </div>
    </div>
  )
}
