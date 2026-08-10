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
const fieldLabelCls = 'block text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1.5'
const sectionTitleCls = 'text-sm font-bold uppercase tracking-wide text-secondary font-display'

function formatAIBillingMode(value: string): string {
  return value === 'client_owned' ? 'Clé client' : 'Clé Orsayn'
}

export default function OffreTab({ row }: { row: ClientRow }) {
  const einvoicingBadge = getEinvoicingBadge(row.einvoicingConfig)

  return (
    <form action={upsertOperatorSubscription} className="grid gap-5 lg:grid-cols-2">
      <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
      {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}

      {row.configSyncError && (
        <div className="card border-l-4 border-l-red-500 bg-red-500/5 px-5 py-4 lg:col-span-2">
          <p className="text-sm font-bold text-red-700 font-display">Erreur de synchronisation</p>
          <p className="mt-1 text-sm text-red-600">{row.configSyncError}</p>
        </div>
      )}

      {/* Section : Identité & contact */}
      <div className="card px-6 py-5 space-y-4">
        <p className={sectionTitleCls}>Identité & contact</p>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 px-4 py-3">
          <span className="text-sm font-semibold text-primary font-display">Essai en cours</span>
          <span className="text-sm text-secondary">{getTrialLabel(row.trialEndsAt, row.trialConverted)}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Libellé</span>
            <input name="label" defaultValue={row.label === row.sourceInstance ? '' : row.label} placeholder="Libellé" className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Email de contact</span>
            <input name="contactEmail" type="email" defaultValue={row.contactEmail ?? ''} placeholder="client@exemple.fr" className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>URL app client</span>
          <input name="appUrl" type="url" defaultValue={row.appUrl ?? ''} placeholder="https://client.fr" className={inputCls} />
        </label>
      </div>

      {/* Section : Offre & tarification */}
      <div className="card px-6 py-5 space-y-4">
        <p className={sectionTitleCls}>Offre & tarification</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Tier</span>
            <select name="tier" defaultValue={row.tier} className={inputCls}>
              {SUBSCRIPTION_TIERS.map((tier) => (
                <option key={tier} value={tier}>{tier}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Mensuel</span>
            <input name="mrrHt" type="number" min="0" step="0.01" defaultValue={row.monthlyFee ?? ''} placeholder="390" className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Devise</span>
            <select name="billingCurrency" defaultValue={row.billingCurrency} className={inputCls}>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Mode dépassement</span>
            <select name="overflowMode" defaultValue={row.overflowMode} className={inputCls}>
              {OVERFLOW_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Mode facturation IA</span>
            <select name="aiBillingMode" defaultValue={row.aiBillingMode} className={inputCls}>
              {AI_BILLING_MODES.map((mode) => (
                <option key={mode} value={mode}>{formatAIBillingMode(mode)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Renouvellement</span>
            <input name="renewsAt" type="date" defaultValue={formatDateInput(row.renewsAt)} className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className={fieldLabelCls}>Notes</span>
          <textarea name="notes" defaultValue={row.notes ?? ''} placeholder="Notes abonnement" rows={2} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-secondary font-body">
          <input name="isActive" type="checkbox" defaultChecked={row.isActive} className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent" />
          Client actif
        </label>
        <p className="text-xs text-secondary">
          Forfait actuel : <span className="font-semibold text-primary">{row.monthlyFee === null ? 'à compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}</span>
        </p>
      </div>

      {/* Section : Facturation électronique */}
      <div className="card px-6 py-5 space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <p className={sectionTitleCls}>Facturation électronique</p>
          <span className={`rounded-pill px-3 py-1 text-xs font-semibold ${einvoicingBadge.className}`}>
            {einvoicingBadge.label}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabelCls}>Mode</span>
            <select name="einvoicingMode" defaultValue={row.einvoicingConfig.mode} className={inputCls}>
              {EINVOICING_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Environnement</span>
            <select name="einvoicingEnvironment" defaultValue={row.einvoicingConfig.environment} className={inputCls}>
              {EINVOICING_ENVIRONMENTS.map((environment) => (
                <option key={environment} value={environment}>{environment}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Modèle d&apos;onboarding</span>
            <select name="einvoicingOnboardingModel" defaultValue={row.einvoicingConfig.onboarding_model ?? ''} className={inputCls}>
              <option value="">Sans onboarding</option>
              {EINVOICING_ONBOARDING_MODELS.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>B2Brouter account id</span>
            <input name="b2brouterAccountId" defaultValue={row.einvoicingConfig.b2brouter_account_id ?? ''} placeholder="B2Brouter account id" className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Statut annuaire</span>
            <select name="einvoicingAnnuaireStatus" defaultValue={row.einvoicingConfig.annuaire_status} className={inputCls}>
              {EINVOICING_ANNUAIRE_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs leading-relaxed text-secondary">
          Réception UI 2026 uniquement en mode B2Brouter. Avant 2027, l&apos;envoi PDF/mail reste normal pour TPE/PME.
        </p>
      </div>

      <button type="submit" className="btn-pill btn-pill-primary w-full text-sm lg:col-span-2">
        Appliquer l&apos;offre
      </button>
    </form>
  )
}
