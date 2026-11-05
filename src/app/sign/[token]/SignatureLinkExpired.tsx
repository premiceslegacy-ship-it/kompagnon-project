'use client'

import { useState, useTransition } from 'react'
import { requestNewQuoteSignatureLink } from '@/lib/data/mutations/signature-link-requests'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PublicError, PublicHeader, PublicPage, PublicSuccess } from '@/components/public/PublicPage'

type Props = {
  token: string
  orgName: string
  orgAddress?: string | null
  quoteNumber?: string | null
  alreadyRequested?: boolean
}

/** Lien de signature expiré : le client demande un nouveau lien, l'artisan l'envoie après accord. */
export default function SignatureLinkExpired({ token, orgName, orgAddress, quoteNumber, alreadyRequested = false }: Props) {
  const [isPending, startTransition] = useTransition()
  const [requested, setRequested] = useState(alreadyRequested)
  const [wasAlreadyRequested, setWasAlreadyRequested] = useState(alreadyRequested)
  const [error, setError] = useState<string | null>(null)

  function handleRequest() {
    setError(null)
    startTransition(async () => {
      const res = await requestNewQuoteSignatureLink(token)
      if (res.error) {
        setError(res.error)
        return
      }
      setWasAlreadyRequested(res.alreadyRequested)
      setRequested(true)
    })
  }

  if (requested) {
    return (
      <PublicPage>
        <PublicHeader name={orgName} address={orgAddress} />
        <PublicSuccess
          title={wasAlreadyRequested ? 'Demande déjà transmise' : 'Demande envoyée'}
          description={`${orgName} est prévenu. Vous recevrez un nouveau lien de signature par email dès son accord.`}
        />
      </PublicPage>
    )
  }

  return (
    <PublicPage>
      <PublicHeader name={orgName} address={orgAddress} />
      <EmptyState
        headingLevel={1}
        title="Ce lien n'est plus valide"
        description={`Le lien pour signer ${quoteNumber ? `le devis ${quoteNumber}` : 'ce devis'} a expiré. Demandez-en un nouveau : ${orgName} est prévenu et vous l'envoie après accord.`}
      />
      <PublicError>{error}</PublicError>
      <div className="mx-auto max-w-[340px]">
        <Button size="lg" className="w-full" onClick={handleRequest} loading={isPending} loadingText="Envoi…">
          Demander un nouveau lien
        </Button>
      </div>
    </PublicPage>
  )
}
