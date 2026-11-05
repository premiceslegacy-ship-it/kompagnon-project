'use client'

import React, { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Hud } from '@/components/ui/Hud'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { PublicError, PublicHeader, PublicNote, PublicPage, PublicSuccess } from '@/components/public/PublicPage'
import { submitClientSignatureWithQuote, sendQuoteDeclineMessage } from '@/lib/data/mutations/contract-sign'

type LinkedQuote = {
  id: string
  number: string | null
  title: string | null
  total_ttc: number | null
}

type LinkedQuoteForDownload = {
  id: string
  accepted: boolean
}

type Props = {
  token: string
  contractId: string
  contractTitle: string
  contractType: 'sous_traitance' | 'maintenance'
  counterpartyName: string
  orgName: string
  orgLogoUrl: string | null
  orgEmail: string | null
  pdfReady: boolean
  alreadySigned: boolean
  signedAt: string | null
  archived: boolean
  publicationUnavailable: boolean
  linkedQuote: LinkedQuote | null
  linkedQuoteForDownload: LinkedQuoteForDownload | null
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

const fmtCurrency = (n: number | null | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
    : null

function SelectedMark({ selected }: { selected: boolean }) {
  if (!selected) return <span className="sr-only">Non choisi</span>
  return (
    <span className="inline-flex size-6 items-center justify-center text-accent-texte">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.5]">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span className="sr-only">Choisi</span>
    </span>
  )
}

function openPdf(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function ContractSignClient({
  token, contractId, contractTitle, contractType, counterpartyName,
  orgName, orgLogoUrl, pdfReady, alreadySigned, signedAt, archived,
  publicationUnavailable, linkedQuote, linkedQuoteForDownload,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [isDeclinePending, startDeclineTransition] = useTransition()

  // 'both' : valider le devis et signer le contrat ; 'contract' : signer le contrat seulement.
  const [mode, setMode] = useState<'both' | 'contract'>(linkedQuote ? 'both' : 'contract')

  const [signed, setSigned] = useState(alreadySigned)
  const [signedAtState, setSignedAtState] = useState<string | null>(signedAt)
  const [pdfReadyState, setPdfReadyState] = useState(pdfReady)
  const [acceptedQuote, setAcceptedQuote] = useState(Boolean(alreadySigned && linkedQuoteForDownload?.accepted))

  const [signatoryName, setSignatoryName] = useState(counterpartyName ?? '')
  const [signatoryRole, setSignatoryRole] = useState('')
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [showDeclineForm, setShowDeclineForm] = useState(false)
  const [declineName, setDeclineName] = useState(counterpartyName ?? '')
  const [declineMessage, setDeclineMessage] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [hudOpen, setHudOpen] = useState(false)

  const both = mode === 'both' && !!linkedQuote
  const contractKind = contractType === 'maintenance' ? 'Contrat de maintenance' : 'Contrat de sous-traitance'
  const subtitle = [contractKind, contractTitle].filter(Boolean).join(' · ')

  const handleSubmit = () => {
    setError(null)
    if (!signatoryName.trim()) return setError('Indiquez votre nom complet.')
    if (!signatureImage) return setError('Dessinez votre signature.')

    startTransition(async () => {
      const res = await submitClientSignatureWithQuote({
        token,
        signatoryName: signatoryName.trim(),
        signatoryRole: signatoryRole.trim() || null,
        signatureImage,
        acceptQuote: both,
      })
      if (res.error) return setError(res.error)
      setSigned(true)
      setSignedAtState(res.signedAt)
      setPdfReadyState(true)
      setAcceptedQuote(res.quoteAccepted)
    })
  }

  const handleDeclineSubmit = () => {
    setDeclineError(null)
    if (!declineName.trim() || !declineMessage.trim()) return setDeclineError('Indiquez votre nom et votre message.')
    startDeclineTransition(async () => {
      const res = await sendQuoteDeclineMessage({
        token,
        senderName: declineName.trim() || counterpartyName,
        message: declineMessage.trim(),
      })
      if (res.error) return setDeclineError(res.error)
      setShowDeclineForm(false)
      setDeclineMessage('')
      setHudOpen(true)
    })
  }

  if (archived) {
    return (
      <PublicPage>
        <PublicHeader name={orgName} logoUrl={orgLogoUrl} />
        <EmptyState headingLevel={1} title="Contrat indisponible" description="Ce contrat est archivé et n'est plus disponible à la signature." />
      </PublicPage>
    )
  }

  if (publicationUnavailable) {
    return (
      <PublicPage>
        <PublicHeader name={orgName} logoUrl={orgLogoUrl} />
        <EmptyState
          headingLevel={1}
          title="Document indisponible"
          description="Cette ancienne publication ne contient pas d'archive vérifiable permettant de signer ou télécharger le contrat. Contactez l'organisation pour recevoir une nouvelle version."
        />
      </PublicPage>
    )
  }

  if (signed && signedAtState) {
    const quoteLabel = linkedQuote?.number ? `le devis ${linkedQuote.number}` : 'le devis'
    return (
      <PublicPage>
        <PublicHeader name={orgName} logoUrl={orgLogoUrl} />
        <PublicSuccess
          title={acceptedQuote ? 'Contrat signé et devis validé' : 'Contrat signé'}
          description={
            <>
              {acceptedQuote
                ? `Vous avez validé ${quoteLabel} et signé le contrat « ${contractTitle} » le ${fmtDateTime(signedAtState)}.`
                : `Vous avez signé le contrat « ${contractTitle} » le ${fmtDateTime(signedAtState)}.`}
              {' '}{orgName} est prévenu de votre signature et reviendra vers vous.
              {!pdfReadyState && ' Le PDF du contrat est en cours de génération, vous le recevrez par email.'}
            </>
          }
        >
          <div className="mt-[6px] grid gap-[10px]">
            {pdfReadyState && (
              <Button size="lg" className="w-full" onClick={() => openPdf(`/api/pdf/contract/${contractId}?token=${encodeURIComponent(token)}&download=1`)}>
                Télécharger le contrat signé
              </Button>
            )}
            {acceptedQuote && linkedQuoteForDownload && (
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={() => openPdf(`/api/pdf/quote/${linkedQuoteForDownload.id}?contractToken=${encodeURIComponent(token)}&download=1`)}
              >
                Télécharger le devis signé
              </Button>
            )}
          </div>
        </PublicSuccess>
      </PublicPage>
    )
  }

  const canSign = Boolean(signatoryName.trim() && signatureImage)
  const linkedQuoteSummary = linkedQuote
    ? [linkedQuote.number, linkedQuote.title, fmtCurrency(linkedQuote.total_ttc)].filter(Boolean).join(' · ')
    : ''

  return (
    <PublicPage>
      <PublicHeader name={orgName} logoUrl={orgLogoUrl} subtitle={subtitle} />
      <p className="mx-espace-4 mb-[14px] mt-[6px] text-sous-titre text-encre-2">
        Vous êtes invité à signer électroniquement ce contrat. Prenez le temps de consulter le document avant de signer.
      </p>

      {linkedQuote && (
        <ListGroup title="Un devis est associé à ce contrat" description={linkedQuoteSummary || undefined}>
          <ListRow
            title="Valider le devis et signer le contrat"
            description="Recommandé : les deux documents sont acceptés en une seule signature."
            onClick={() => setMode('both')}
            trailing={<SelectedMark selected={mode === 'both'} />}
          />
          <ListRow
            title="Signer le contrat uniquement"
            description="Le devis reste en attente de validation séparée."
            onClick={() => setMode('contract')}
            trailing={<SelectedMark selected={mode === 'contract'} />}
          />
        </ListGroup>
      )}

      <ListGroup>
        {pdfReadyState ? (
          <ListRow
            title="Consulter le contrat"
            description="Ouvre le PDF dans un nouvel onglet"
            href={`/api/pdf/contract/${contractId}?token=${encodeURIComponent(token)}`}
            target="_blank"
            rel="noopener noreferrer"
          />
        ) : (
          <ListRow title="Consulter le contrat" description="Le PDF du contrat est en cours de génération." />
        )}
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
          width={608}
          height={184}
          hint="Signez avec le doigt ou la souris"
        />
      </section>

      <PublicNote>
        {both
          ? `En signant, vous reconnaissez avoir pris connaissance du devis${linkedQuote?.number ? ` ${linkedQuote.number}` : ''} et du contrat, et vous les acceptez sans réserve.`
          : 'En signant, vous reconnaissez avoir pris connaissance des termes du contrat et vous l\'acceptez sans réserve.'}
      </PublicNote>

      <PublicError>{error}</PublicError>

      <div className="mt-espace-20">
        <Button
          size="lg"
          className="w-full"
          onClick={handleSubmit}
          disabled={!canSign}
          loading={isPending}
          loadingText="Signature en cours…"
        >
          {both ? 'Signer le contrat et valider le devis' : 'Signer le contrat'}
        </Button>
      </div>

      {linkedQuote && (
        <>
          <PublicNote centered>Vous ne souhaitez pas valider le devis&nbsp;?</PublicNote>
          <div className="flex justify-center">
            <Button variant="text" onClick={() => setShowDeclineForm((open) => !open)} aria-expanded={showDeclineForm}>
              {showDeclineForm ? 'Fermer' : 'Envoyer un message'}
            </Button>
          </div>
          {showDeclineForm && (
            <>
              <ListGroup>
                <li className="border-b border-trait">
                  <Field
                    type="text"
                    label="Votre nom"
                    value={declineName}
                    onChange={(event) => setDeclineName(event.currentTarget.value)}
                    placeholder="Prénom et nom"
                    autoComplete="name"
                  />
                </li>
                <li>
                  <Field
                    type="textarea"
                    label="Votre message"
                    value={declineMessage}
                    onChange={(event) => setDeclineMessage(event.currentTarget.value)}
                    placeholder="Expliquez vos remarques, demandez une modification du devis, proposez un autre montant…"
                    rows={4}
                  />
                </li>
              </ListGroup>
              <PublicError>{declineError}</PublicError>
              <div className="mt-[12px]">
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  onClick={handleDeclineSubmit}
                  loading={isDeclinePending}
                  loadingText="Envoi…"
                >
                  Envoyer le message
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <PublicNote centered>Adresse IP et horodatage enregistrés comme preuve de signature.</PublicNote>
      <Hud open={hudOpen} onOpenChange={setHudOpen} message={`Votre message a bien été envoyé à ${orgName}`} />
    </PublicPage>
  )
}
