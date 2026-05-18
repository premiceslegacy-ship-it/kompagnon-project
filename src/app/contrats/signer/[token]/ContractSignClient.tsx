'use client'

import React, { useState, useTransition } from 'react'
import { CheckCircle2, FileText, Loader2, ShieldCheck, AlertTriangle, ExternalLink, MessageSquare, X, ChevronDown } from 'lucide-react'
import SignaturePad from '@/components/SignaturePad'
import { submitClientSignatureWithQuote, sendQuoteDeclineMessage } from '@/lib/data/mutations/contract-sign'

type LinkedQuote = {
  id: string
  number: string | null
  title: string | null
  total_ttc: number | null
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
  linkedQuote: LinkedQuote | null
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

const fmtCurrency = (n: number | null | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
    : null

export default function ContractSignClient({
  token, contractId, contractTitle, contractType, counterpartyName,
  orgName, orgLogoUrl, orgEmail, pdfReady, alreadySigned, signedAt, archived, linkedQuote,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [isDeclinePending, startDeclineTransition] = useTransition()

  // Choix du mode : 'both' = valider devis + signer, 'contract' = signer seulement
  const [mode, setMode] = useState<'both' | 'contract'>(linkedQuote ? 'both' : 'contract')
  const [showModeSelector, setShowModeSelector] = useState(false)

  // États post-soumission
  const [signed, setSigned] = useState(alreadySigned)
  const [signedAtState, setSignedAtState] = useState<string | null>(signedAt)
  const [pdfReadyState, setPdfReadyState] = useState(pdfReady)
  const [acceptedQuote, setAcceptedQuote] = useState(false)

  // Champs du formulaire
  const [signatoryName, setSignatoryName] = useState(counterpartyName ?? '')
  const [signatoryRole, setSignatoryRole] = useState('')
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Formulaire de refus/contre-proposition
  const [showDeclineForm, setShowDeclineForm] = useState(false)
  const [declineName, setDeclineName] = useState(counterpartyName ?? '')
  const [declineMessage, setDeclineMessage] = useState('')
  const [declineSent, setDeclineSent] = useState(false)
  const [declineError, setDeclineError] = useState<string | null>(null)

  const handleSubmit = () => {
    setError(null)
    if (!signatoryName.trim()) return setError('Veuillez renseigner votre nom complet.')
    if (!signatureImage) return setError('Veuillez dessiner votre signature.')
    if (!confirmed) return setError('Veuillez confirmer votre accord.')

    startTransition(async () => {
      const res = await submitClientSignatureWithQuote({
        token,
        signatoryName: signatoryName.trim(),
        signatoryRole: signatoryRole.trim() || null,
        signatureImage,
        acceptQuote: mode === 'both' && !!linkedQuote,
      })
      if (res.error) return setError(res.error)
      setSigned(true)
      setSignedAtState(res.signedAt)
      setPdfReadyState(true)
      setAcceptedQuote(mode === 'both' && !!linkedQuote)
    })
  }

  const handleDeclineSubmit = () => {
    setDeclineError(null)
    if (!declineMessage.trim()) return setDeclineError('Veuillez rédiger votre message.')
    startDeclineTransition(async () => {
      const res = await sendQuoteDeclineMessage({
        token,
        senderName: declineName.trim() || counterpartyName,
        message: declineMessage.trim(),
      })
      if (res.error) return setDeclineError(res.error)
      setDeclineSent(true)
    })
  }

  // ── État archivé ─────────────────────────────────────────────────────────────

  if (archived) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow max-w-md w-full p-10 text-center space-y-4">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Contrat indisponible</h1>
          <p className="text-sm text-gray-500">Ce contrat est archivé et n&apos;est plus disponible à la signature.</p>
        </div>
      </div>
    )
  }

  // ── État signé (succès) ───────────────────────────────────────────────────────

  if (signed && signedAtState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-10 text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">
              {acceptedQuote ? 'Devis validé et contrat signé' : 'Contrat signé'}
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              {acceptedQuote
                ? `Vous avez validé le devis et signé le contrat « ${contractTitle} » le `
                : `Vous avez signé le contrat « ${contractTitle} » le `}
              <strong className="text-gray-700">{fmtDateTime(signedAtState)}</strong>.
            </p>
          </div>
          {acceptedQuote && linkedQuote && (
            <div className="flex items-center gap-2 justify-center px-4 py-2 bg-green-50 border border-green-200 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-800 font-semibold">
                Devis {linkedQuote.number} marqué comme accepté
              </p>
            </div>
          )}
          {pdfReadyState ? (
            <a
              href={`/api/pdf/contract/${contractId}?token=${token}&download=1`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText className="w-4 h-4" />
              Télécharger le contrat signé
            </a>
          ) : (
            <p className="text-sm text-gray-400 italic">Le PDF est en cours de génération, vous le recevrez par e-mail.</p>
          )}
          <p className="text-xs text-gray-400">
            {orgName} a été notifié de votre signature et reviendra vers vous.
          </p>
        </div>
      </div>
    )
  }

  // ── Formulaire de signature ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6 pt-10">
      <div className="w-full max-w-2xl space-y-5">

        {/* En-tête org */}
        <div className="text-center mb-2">
          {orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={orgLogoUrl} alt={orgName} className="h-12 mx-auto mb-2 object-contain" />
          ) : null}
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-widest">{orgName}</p>
        </div>

        {/* Bandeau contrat */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-900 px-6 py-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {contractType === 'maintenance' ? 'Contrat de maintenance' : 'Contrat de sous-traitance'}
            </p>
            <h1 className="text-lg font-bold text-white mt-1">{contractTitle}</h1>
          </div>

          <div className="p-6 space-y-5">

            {/* Devis lié - choix principal si présent */}
            {linkedQuote && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <FileText className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-amber-900">Un devis est associé à ce contrat</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {linkedQuote.number}{linkedQuote.title ? ` - ${linkedQuote.title}` : ''}
                      {fmtCurrency(linkedQuote.total_ttc) ? ` · ${fmtCurrency(linkedQuote.total_ttc)}` : ''}
                    </p>
                  </div>
                </div>

                {/* Choix du mode */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setMode('both')}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-colors text-left ${mode === 'both' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400 bg-white'}`}
                  >
                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${mode === 'both' ? 'border-white' : 'border-gray-400'}`}>
                      {mode === 'both' && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${mode === 'both' ? 'text-white' : 'text-gray-900'}`}>
                        Valider le devis et signer le contrat
                      </p>
                      <p className={`text-xs mt-0.5 ${mode === 'both' ? 'text-gray-300' : 'text-gray-500'}`}>
                        Recommandé - Les deux documents sont acceptés en une seule signature
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('contract')}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-colors text-left ${mode === 'contract' ? 'border-gray-600 bg-gray-50' : 'border-gray-200 hover:border-gray-400 bg-white'}`}
                  >
                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${mode === 'contract' ? 'border-gray-600' : 'border-gray-400'}`}>
                      {mode === 'contract' && <div className="w-2.5 h-2.5 rounded-full bg-gray-600" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700">Signer le contrat uniquement</p>
                      <p className="text-xs text-gray-500 mt-0.5">Le devis reste en attente de validation séparée</p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Info sécurité si pas de devis lié */}
            {!linkedQuote && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-900 leading-relaxed">
                  Vous êtes invité à signer électroniquement ce contrat. Prenez le temps de consulter le document avant de signer.
                </p>
              </div>
            )}

            {/* Lien PDF */}
            {pdfReadyState ? (
              <a
                href={`/api/pdf/contract/${contractId}?token=${token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 p-4 border border-gray-200 rounded-xl hover:border-gray-900 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-gray-700" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Consulter le contrat</p>
                    <p className="text-xs text-gray-500">Ouvre le PDF dans un nouvel onglet</p>
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-gray-900" />
              </a>
            ) : (
              <p className="text-xs text-gray-500 italic">Le PDF du contrat est en cours de génération.</p>
            )}

            {/* Champs signature */}
            <div className="space-y-3 pt-3 border-t border-gray-100">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Votre nom complet</label>
                <input
                  type="text"
                  value={signatoryName}
                  onChange={e => setSignatoryName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none"
                  placeholder="Prénom et nom"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Fonction <span className="font-normal text-gray-400">(optionnel)</span>
                </label>
                <input
                  type="text"
                  value={signatoryRole}
                  onChange={e => setSignatoryRole(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none"
                  placeholder="Ex : Gérant, Directeur technique…"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Signature manuscrite</label>
                <SignaturePad
                  value={signatureImage}
                  onChange={setSignatureImage}
                  width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 80 : 480)}
                  height={180}
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  {mode === 'both' && linkedQuote
                    ? `Je reconnais avoir pris connaissance du devis ${linkedQuote.number ?? ''} et du contrat, et je les accepte sans réserve. Ma signature vaut acceptation des deux documents.`
                    : `Je reconnais avoir pris connaissance des termes du contrat et je l'accepte sans réserve. Ma signature manuscrite vaut acceptation.`
                  }
                </span>
              </label>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="button"
                disabled={isPending || !confirmed || !signatureImage || !signatoryName.trim()}
                onClick={handleSubmit}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Signature en cours…</>
                ) : mode === 'both' && linkedQuote ? (
                  <><CheckCircle2 className="w-4 h-4" /> Valider le devis et signer le contrat</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" /> Je signe le contrat</>
                )}
              </button>
            </div>

            {/* Refus / contre-proposition devis */}
            {linkedQuote && (
              <div className="pt-2 border-t border-gray-100">
                {!showDeclineForm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeclineForm(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Je ne souhaite pas valider le devis - envoyer un message
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                ) : declineSent ? (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800 font-semibold">Votre message a bien été envoyé à {orgName}.</p>
                  </div>
                ) : (
                  <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-gray-800">Envoyer un message à {orgName}</p>
                      <button type="button" onClick={() => setShowDeclineForm(false)} className="text-gray-400 hover:text-gray-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Votre nom</label>
                      <input
                        type="text"
                        value={declineName}
                        onChange={e => setDeclineName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-gray-900 outline-none"
                        placeholder="Prénom et nom"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Votre message</label>
                      <textarea
                        value={declineMessage}
                        onChange={e => setDeclineMessage(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-gray-900 outline-none resize-none"
                        placeholder="Expliquez vos remarques, demandez une modification du devis, proposez un autre montant…"
                      />
                    </div>
                    {declineError && (
                      <p className="text-xs text-red-600 font-semibold">{declineError}</p>
                    )}
                    <button
                      type="button"
                      disabled={isDeclinePending || !declineMessage.trim()}
                      onClick={handleDeclineSubmit}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isDeclinePending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Envoi…</>
                      ) : (
                        <><MessageSquare className="w-4 h-4" /> Envoyer le message</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center leading-relaxed">
          Adresse IP et horodatage enregistrés comme preuve de signature.
        </p>
      </div>
    </div>
  )
}
