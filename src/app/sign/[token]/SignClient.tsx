'use client'

import React, { useState, useTransition } from 'react'
import { acceptQuoteByToken } from '@/lib/data/mutations/sign'
import { CheckCircle2, Loader2, ShieldCheck, FileText, AlertTriangle } from 'lucide-react'

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)

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
  alreadySigned: boolean
  signedAt: string | null
}

export default function SignClient({
  token, quoteNumber, quoteTitle, totalTtc, currency,
  validUntil, orgName, orgAddress, clientName, alreadySigned, signedAt,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [accepted, setAccepted] = useState(alreadySigned)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(signedAt)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const validUntilDate = validUntil
    ? new Date(validUntil).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  function handleAccept() {
    if (!confirmed) return
    startTransition(async () => {
      const res = await acceptQuoteByToken(token)
      if (res.error) {
        setError(res.error)
      } else {
        setAccepted(true)
        setAcceptedAt(res.signedAt)
      }
    })
  }

  // ── État : déjà signé ──
  if (accepted && acceptedAt) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-10 text-center space-y-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Devis accepté !</h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              Vous avez accepté {quoteNumber ? `le devis N°\u00a0${quoteNumber}` : 'ce devis'}
              {quoteTitle ? ` « ${quoteTitle} »` : ''} le{' '}
              <strong className="text-gray-700">{fmtDate(acceptedAt)}</strong>.
            </p>
          </div>
          {totalTtc != null && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
              <p className="text-sm text-green-700 font-medium">Montant TTC accepté</p>
              <p className="text-3xl font-bold text-green-800 mt-1">{fmt(totalTtc, currency)}</p>
            </div>
          )}
          <p className="text-xs text-gray-400 leading-relaxed">
            Un email de confirmation vous a été envoyé. Conservez-le comme preuve d'acceptation.
            <br />{orgName} prendra contact avec vous prochainement.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start p-6 pt-12">
      <div className="w-full max-w-lg space-y-6">

        {/* Header émetteur */}
        <div className="text-center mb-2">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-1">{orgName}</p>
          {orgAddress && <p className="text-xs text-gray-400">{orgAddress}</p>}
        </div>

        {/* Carte devis */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Bandeau titre */}
          <div className="bg-gray-900 px-8 py-6">
            <div className="flex items-center gap-3 mb-1">
              <FileText className="w-5 h-5 text-white/60" />
              <span className="text-white/60 text-sm font-medium uppercase tracking-wider">
                Devis{quoteNumber ? ` N°\u00a0${quoteNumber}` : ''}
              </span>
            </div>
            <h1 className="text-white text-xl font-bold leading-tight">
              {quoteTitle ?? 'Proposition commerciale'}
            </h1>
            {validUntilDate && (
              <p className="text-white/50 text-xs mt-2">Valable jusqu&apos;au {validUntilDate}</p>
            )}
          </div>

          {/* Détails */}
          <div className="px-8 py-6 space-y-4">
            {clientName && (
              <div className="flex justify-between items-start">
                <span className="text-sm text-gray-500">Destinataire</span>
                <span className="text-sm font-semibold text-gray-800 text-right">{clientName}</span>
              </div>
            )}
            {totalTtc != null && (
              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                <span className="text-sm text-gray-500">Montant TTC</span>
                <span className="text-2xl font-bold text-gray-900">{fmt(totalTtc, currency)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Carte signature */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-7 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-500 leading-relaxed">
              En cliquant sur «&nbsp;J&apos;accepte ce devis&nbsp;», vous confirmez avoir lu et approuvé l&apos;ensemble
              des conditions décrites dans ce devis. La date, l&apos;heure et votre adresse IP seront
              enregistrées comme preuve d&apos;accord.
            </p>
          </div>

          {/* Checkbox confirmation */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer"
              />
            </div>
            <span className="text-sm text-gray-700 leading-relaxed select-none">
              J&apos;ai lu et j&apos;accepte les conditions de ce devis et souhaite le valider.
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleAccept}
            disabled={!confirmed || isPending}
            className="w-full py-4 rounded-2xl bg-gray-900 text-white font-bold text-base flex items-center justify-center gap-3 hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <><Loader2 className="w-5 h-5 animate-spin" />Enregistrement…</>
            ) : (
              <><CheckCircle2 className="w-5 h-5" />J&apos;accepte ce devis</>
            )}
          </button>
        </div>

        {/* Sécurité */}
        <p className="text-center text-xs text-gray-400 pb-8">
          Lien sécurisé, transmis par {orgName}
        </p>
      </div>
    </div>
  )
}
