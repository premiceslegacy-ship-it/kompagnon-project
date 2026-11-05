'use client'

import React, { useState, useTransition } from 'react'
import { acceptQuoteByToken } from '@/lib/data/mutations/sign'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { StatTile } from '@/components/ui/StatTile'
import { PublicError, PublicHeader, PublicNote, PublicPage, PublicSuccess } from '@/components/public/PublicPage'
import SignatureLinkExpired from './SignatureLinkExpired'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

/** Message renvoyé par `acceptQuoteByToken` quand le lien expire pendant la saisie. */
const EXPIRED_ERROR = 'Ce lien de signature a expiré.'

type Props = {
  token: string
  quoteNumber: string | null
  quoteTitle: string | null
  totalTtc: number | null
  currency: string
  validUntil: string | null
  orgName: string
  orgAddress: string | null
  clientName: string | null
  quoteId: string
  alreadySigned: boolean
  signedAt: string | null
  signatoryName: string | null
}

export default function SignClient({
  token, quoteNumber, quoteTitle, totalTtc, currency,
  validUntil, orgName, orgAddress, clientName, quoteId, alreadySigned, signedAt, signatoryName: initialSignatoryName,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [accepted, setAccepted] = useState(alreadySigned)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(signedAt)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [signatoryName, setSignatoryName] = useState(initialSignatoryName ?? '')
  const [signatoryRole, setSignatoryRole] = useState('')
  const [signatureImage, setSignatureImage] = useState<string | null>(null)

  const pdfUrl = `/api/pdf/quote/${quoteId}?token=${encodeURIComponent(token)}`
  const subtitle = [quoteNumber ? `Devis ${quoteNumber}` : 'Devis', quoteTitle].filter(Boolean).join(' · ')
  const recipientLine = [
    clientName ? `Pour ${clientName}` : null,
    validUntil ? `valable jusqu'au ${fmtDate(validUntil)}` : null,
  ].filter(Boolean).join(' · ')

  function handleAccept() {
    setError(null)
    if (!signatoryName.trim()) return setError('Indiquez votre nom complet.')
    if (!signatureImage) return setError('Dessinez votre signature.')
    startTransition(async () => {
      const res = await acceptQuoteByToken({
        token,
        signatoryName: signatoryName.trim(),
        signatoryRole: signatoryRole.trim() || null,
        signatureImage,
      })
      if (res.error) {
        if (res.error === EXPIRED_ERROR) setExpired(true)
        else setError(res.error)
      } else {
        setAccepted(true)
        setAcceptedAt(res.signedAt)
      }
    })
  }

  if (expired) {
    return <SignatureLinkExpired token={token} orgName={orgName} orgAddress={orgAddress} quoteNumber={quoteNumber} />
  }

  if (accepted && acceptedAt) {
    return (
      <PublicPage>
        <PublicHeader name={orgName} address={orgAddress} />
        <PublicSuccess
          title="Devis accepté"
          description={`Vous avez accepté ${quoteNumber ? `le devis ${quoteNumber}` : 'ce devis'} le ${fmtDateTime(acceptedAt)}. Téléchargez et conservez le devis signé.`}
        >
          {totalTtc != null && (
            <StatTile className="mb-[18px] mt-[10px]" label="Montant TTC accepté" value={fmt(totalTtc, currency)} />
          )}
          <Button
            size="lg"
            className="w-full"
            onClick={() => window.open(`${pdfUrl}&download=1`, '_blank', 'noopener,noreferrer')}
          >
            Télécharger le devis signé
          </Button>
        </PublicSuccess>
      </PublicPage>
    )
  }

  const canSign = Boolean(signatoryName.trim() && signatureImage)

  return (
    <PublicPage>
      <PublicHeader name={orgName} address={orgAddress} subtitle={subtitle} />

      {totalTtc != null ? (
        <StatTile
          className="mt-[6px]"
          label="Montant TTC"
          value={fmt(totalTtc, currency)}
          detail={recipientLine || undefined}
        />
      ) : recipientLine ? <PublicNote>{recipientLine}</PublicNote> : null}

      <ListGroup>
        <ListRow
          title="Consulter le devis"
          description="Ouvre le PDF dans un nouvel onglet"
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
        />
      </ListGroup>

      <ListGroup>
        <li className="border-b border-trait">
          <Field
            type="text"
            label="Nom complet"
            value={signatoryName}
            onChange={(event) => setSignatoryName(event.currentTarget.value)}
            placeholder="Prénom et nom"
            autoComplete="name"
            required
          />
        </li>
        <li>
          <Field
            type="text"
            label="Fonction"
            value={signatoryRole}
            onChange={(event) => setSignatoryRole(event.currentTarget.value)}
            placeholder="Fonction (facultatif)"
            autoComplete="organization-title"
          />
        </li>
      </ListGroup>

      <section className="mt-espace-24" aria-labelledby="signature-heading">
        <h2 id="signature-heading" className="mx-espace-16 mb-[6px] mt-0 text-note font-atelier-medium text-encre-2">
          Signature manuscrite
        </h2>
        <SignaturePad
          value={signatureImage}
          onChange={setSignatureImage}
          surface="paper"
          width={528}
          height={176}
        />
      </section>

      <PublicNote>
        En signant ce devis, vous confirmez avoir lu et approuvé l&apos;ensemble des conditions décrites.
      </PublicNote>

      <PublicError>{error}</PublicError>

      <div className="mt-espace-20">
        <Button
          size="lg"
          className="w-full"
          onClick={handleAccept}
          disabled={!canSign}
          loading={isPending}
          loadingText="Signature en cours…"
        >
          Signer le devis
        </Button>
      </div>
      <PublicNote centered>Adresse IP et horodatage enregistrés comme preuve de signature.</PublicNote>
    </PublicPage>
  )
}
