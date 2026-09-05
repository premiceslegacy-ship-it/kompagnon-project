'use client'

import { useFormStatus } from 'react-dom'
import { ArrowRight } from 'lucide-react'
import styles from './activation.module.css'

export function CheckoutSubmitButton({ label, pendingLabel = 'Ouverture de Stripe…', featured = false }: { label: string; pendingLabel?: string; featured?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${styles.checkoutButton} ${featured ? styles.checkoutButtonFeatured : ''}`}
    >
      {pending ? pendingLabel : label} {!pending && <ArrowRight className="h-4 w-4" />}
    </button>
  )
}
