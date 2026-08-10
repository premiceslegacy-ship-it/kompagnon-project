'use client'

import { upsertOperatorSubscription } from '../actions'
import { formatDateInput, formatMoney, getEinvoicingBadge, getTrialLabel } from '../utils'
import { AI_BILLING_MODES, type ClientRow } from '../types'
import {
  SUBSCRIPTION_TIERS,
  OVERFLOW_MODES,
} from '@/lib/quota-catalog'
import {
  EINVOICING_ANNUAIRE_STATUSES,
  EINVOICING_ENVIRONMENTS,
  EINVOICING_MODES,
  EINVOICING_ONBOARDING_MODELS,
} from '@/lib/einvoicing-config'

const inputCls = 'w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none'

function formatAIBillingMode(value: string): string {
  return value === 'client_owned' ? 'Clé client' : 'Clé Orsayn'
}

export default function OffreTab({ row }: { row: ClientRow }) {
  const einvoicingBadge = getEinvoicingBadge(row.einvoicingConfig)

  return (
    <form action={upsertOperatorSubscription} className="space-y-4">
      <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
      {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}

      {row.configSyncError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
          <p className="text-xs font-semibold text-red-700">Erreur de synchronisation</p>
          <p className="mt-1 text-xs text-red-600">{row.configSyncError}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--elevation-border)] bg-white/[0.03] px-3 py-2 text-xs">
        <span className="font-semibold text-primary font-display">Essai</span>
        <span className="text-secondary">
          {getTrialLabel(row.trialEndsAt, row.trialConverted)}
        </span>
      </div>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Libellé</span>
        <input name="label" defaultValue={row.label === row.sourceInstance ? '' : row.label} placeholder="Libellé" className={inputCls} />
      </label>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">URL app client</span>
        <input name="appUrl" type="url" defaultValue={row.appUrl ?? ''} placeholder="https://client.fr" className={inputCls} />
      </label>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Email de contact</span>
        <input name="contactEmail" type="email" defaultValue={row.contactEmail ?? ''} placeholder="client@exemple.fr" className={inputCls} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5 text-sm font-body">
          <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Tier</span>
          <select name="tier" defaultValue={row.tier} className={inputCls}>
            {SUBSCRIPTION_TIERS.map((tier) => (
              <option key={tier} value={tier}>{tier}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-body">
          <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Mensuel</span>
          <input name="mrrHt" type="number" min="0" step="0.01" defaultValue={row.monthlyFee ?? ''} placeholder="390" className={inputCls} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5 text-sm font-body">
          <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Devise</span>
          <select name="billingCurrency" defaultValue={row.billingCurrency} className={inputCls}>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-body">
          <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Mode dépassement</span>
          <select name="overflowMode" defaultValue={row.overflowMode} className={inputCls}>
            {OVERFLOW_MODES.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Mode facturation IA</span>
        <select name="aiBillingMode" defaultValue={row.aiBillingMode} className={inputCls}>
          {AI_BILLING_MODES.map((mode) => (
            <option key={mode} value={mode}>{formatAIBillingMode(mode)}</option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Renouvellement</span>
        <input name="renewsAt" type="date" defaultValue={formatDateInput(row.renewsAt)} className={inputCls} />
      </label>

      <label className="block space-y-1.5 text-sm font-body">
        <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Notes</span>
        <textarea name="notes" defaultValue={row.notes ?? ''} placeholder="Notes abonnement" rows={2} className={inputCls} />
      </label>

      <div className="rounded-lg border border-[var(--elevation-border)] bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Facturation électronique</p>
          <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${einvoicingBadge.className}`}>
            {einvoicingBadge.label}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select name="einvoicingMode" defaultValue={row.einvoicingConfig.mode} className={inputCls}>
            {EINVOICING_MODES.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
          <select name="einvoicingEnvironment" defaultValue={row.einvoicingConfig.environment} className={inputCls}>
            {EINVOICING_ENVIRONMENTS.map((environment) => (
              <option key={environment} value={environment}>{environment}</option>
            ))}
          </select>
          <select name="einvoicingOnboardingModel" defaultValue={row.einvoicingConfig.onboarding_model ?? ''} className={inputCls}>
            <option value="">Sans onboarding</option>
            {EINVOICING_ONBOARDING_MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <input name="b2brouterAccountId" defaultValue={row.einvoicingConfig.b2brouter_account_id ?? ''} placeholder="B2Brouter account id" className={inputCls} />
          <select name="einvoicingAnnuaireStatus" defaultValue={row.einvoicingConfig.annuaire_status} className={inputCls}>
            {EINVOICING_ANNUAIRE_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-secondary">
          Réception UI 2026 uniquement en mode B2Brouter. Avant 2027, l&apos;envoi PDF/mail reste normal pour TPE/PME.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-secondary font-body">
        <input name="isActive" type="checkbox" defaultChecked={row.isActive} className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent" />
        Actif
      </label>

      <p className="text-[11px] text-secondary">
        Forfait actuel : {row.monthlyFee === null ? 'à compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
      </p>

      <button type="submit" className="btn-pill btn-pill-primary w-full text-sm">
        Appliquer l&apos;offre
      </button>
    </form>
  )
}
