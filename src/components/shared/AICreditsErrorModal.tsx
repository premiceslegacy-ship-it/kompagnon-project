'use client'
// @atelier-migrated

import { AlertDialog } from '@/components/ui/AlertDialog'

type Props = {
  onClose: () => void
}

const RECHARGE_URL = 'https://openrouter.ai/settings/credits'

/** Prévient que l'assistante est en pause faute de crédit, sans jargon de fournisseur. */
export default function AICreditsErrorModal({ onClose }: Props) {
  return (
    <AlertDialog
      open
      onOpenChange={open => { if (!open) onClose() }}
      title="L’assistante est en pause"
      description="Le crédit de votre compte IA est épuisé, ou la clé n’est plus valide. Rechargez-le pour reprendre. Vos documents ne sont pas touchés."
      confirmLabel="Recharger le crédit"
      cancelLabel="Plus tard"
      onConfirm={() => {
        window.open(RECHARGE_URL, '_blank', 'noopener,noreferrer')
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
