'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  History,
  Layers3,
  Mail,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserRound,
  Zap,
} from 'lucide-react'
import {
  activateOperatorTrial,
  archiveOperatorClient,
  convertOperatorTrial,
  deleteOperatorClient,
  expireOperatorTrial,
  extendOperatorTrial,
  resyncOperatorClientConfig,
  restoreOperatorClient,
  upsertOperatorClientMetalPricing,
  upsertOperatorClientModules,
  upsertOperatorClientVerticalPack,
  upsertOperatorSubscription,
} from './actions'
import SetupActivationForm from './SetupActivationForm'
import ActionForm from './ActionForm'
import type { ClientRow } from './types'
import {
  formatAIBillingMode,
  formatClientOffer,
  formatDate,
  formatDateInput,
  formatMoney,
  formatOnboardingStatus,
  formatOverflowMode,
  formatQuotaValue,
  formatSyncStatus,
  formatTier,
  getEinvoicingBadge,
  getEventLabel,
  getCommercialEventLabel,
  getLatestQuotaRows,
  getQuotaBadgeClass,
  getSyncBadge,
  getTrialLabel,
  MODULE_LABELS,
  normalizeNumber,
  isActiveTrial,
} from './utils'
import { ORGANIZATION_MODULE_KEYS } from '@/lib/organization-modules'
import { VERTICAL_PACKS, getEligibleVerticalPack } from '@/lib/vertical-packs'
import { EINVOICING_ANNUAIRE_STATUSES, EINVOICING_ENVIRONMENTS, EINVOICING_MODES } from '@/lib/einvoicing-config'
import { OVERFLOW_MODES, QUOTA_DEFINITIONS, SUBSCRIPTION_TIERS } from '@/lib/quota-catalog'
import { UNRESOLVED_ORGANIZATION_ID } from '@/lib/operator/trial-lifecycle'
import { UsageTrendChart } from './UsageCharts'

const inputClass = 'cockpit-input w-full'
const tabs = [
  { id: 'offer', label: 'Offre', icon: FileText },
  { id: 'usage', label: 'Consommation', icon: Zap },
  { id: 'modules', label: 'Modules', icon: Layers3 },
  { id: 'history', label: 'Historique', icon: History },
] as const
type DetailTab = typeof tabs[number]['id']

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`cockpit-panel ${className}`}>{children}</section>
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="border-l border-[var(--cockpit-line)] pl-4 first:border-0"><p className="cockpit-eyebrow">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-primary">{value}</p>{hint && <p className="mt-1 text-xs text-secondary">{hint}</p>}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="cockpit-label">{label}</span>{children}</label>
}

function labelForEinvoicingMode(mode: string) {
  return { off: 'Non activée', export_only: 'Dépôt manuel', super_pdp: 'Envoi automatisé' }[mode] ?? mode
}

function labelForAnnuaire(value: string) {
  return { not_started: 'Pas encore lancé', pending: 'En vérification', active: 'Actif', error: 'À vérifier' }[value] ?? value
}

function OfferTab({ row }: { row: ClientRow }) {
  const einvoicing = getEinvoicingBadge(row.einvoicingConfig)
  return <div className="space-y-4"><ActionForm action={upsertOperatorSubscription} className="grid gap-4 lg:grid-cols-2" feedbackClassName="lg:col-span-2" successMessage="Offre et informations client enregistrées.">
    <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
    {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}
    <Panel className="space-y-4 p-5"><div><p className="text-lg font-semibold text-primary">Identité et contact</p><p className="mt-1 text-sm text-secondary">Les informations utilisées pour le suivi commercial.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nom du client"><input name="label" defaultValue={row.label === row.sourceInstance ? '' : row.label} className={inputClass} /></Field><Field label="Email de contact"><input name="contactEmail" type="email" defaultValue={row.contactEmail ?? ''} className={inputClass} /></Field></div>{row.billingModel === 'setup' ? <><input type="hidden" name="appUrl" value="https://app.atelier-btp.fr/" /><Field label="URL de l’espace client"><span className="block text-sm text-primary">https://app.atelier-btp.fr/</span></Field></> : <Field label="URL de l’espace client"><input name="appUrl" type="url" defaultValue={row.appUrl ?? ''} className={inputClass} /><p className="mt-1 text-xs text-secondary">Utilisée pour renvoyer la configuration et les liens d’accès.</p></Field>}<p className="flex items-center gap-2 text-xs text-secondary"><span className="h-2 w-2 rounded-full bg-accent" /> Identifiant technique : {row.sourceInstance}</p><p className="text-xs leading-5 text-secondary">{row.isOrganizationResolved ? 'Organisation cliente reliée : les réglages peuvent être synchronisés.' : 'Préconfiguration uniquement : renseigne l’organisation réelle avant d’activer les modules ou de synchroniser.'}</p></Panel>
    <Panel className="space-y-4 p-5"><div><p className="text-lg font-semibold text-primary">{row.billingModel === 'setup' ? 'Achat setup' : 'Formule et tarif'}</p><p className="mt-1 text-sm text-secondary">{row.billingModel === 'setup' ? 'Les paramètres d’accès restent hors abonnement récurrent.' : 'Le forfait IA est indépendant de la facturation électronique.'}</p></div>{row.billingModel === 'setup' ? <><input type="hidden" name="tier" value="setup_only" /><input type="hidden" name="mrrHt" value="0" /><input type="hidden" name="billingCurrency" value="EUR" /><input type="hidden" name="overflowMode" value="block" /><input type="hidden" name="aiBillingMode" value="client_owned" /><input type="hidden" name="renewsAt" value="" /><div className="space-y-2 text-sm text-secondary"><p>Prix réglé : 3 000 € HT, en une fois.</p><p>MRR HT : {formatMoney(0, 'EUR')} par mois.</p><p>La consommation IA est imputée au compte OpenRouter du client.</p><p>Accès Atelier sans abonnement récurrent.</p></div></> : <><div className="grid gap-4 sm:grid-cols-2"><Field label="Formule"><select name="tier" defaultValue={row.tier} className={inputClass}>{SUBSCRIPTION_TIERS.map((tier) => <option key={tier} value={tier}>{formatTier(tier)}</option>)}</select></Field><Field label="Mensuel HT"><input name="mrrHt" type="number" min="0" step="0.01" defaultValue={row.monthlyFee ?? ''} className={inputClass} /></Field><Field label="Devise"><select name="billingCurrency" defaultValue={row.billingCurrency} className={inputClass}><option value="EUR">EUR</option><option value="USD">USD</option></select></Field><Field label="Si le client dépasse son forfait"><select name="overflowMode" defaultValue={row.overflowMode} className={inputClass}>{OVERFLOW_MODES.map((mode) => <option key={mode} value={mode}>{formatOverflowMode(mode)}</option>)}</select></Field></div><Field label="Qui paie l’IA ?"><select name="aiBillingMode" defaultValue={row.aiBillingMode} className={inputClass}><option value="orsayn_shared">Orsayn</option><option value="client_owned">{formatAIBillingMode('client_owned')}</option></select></Field><Field label="Prochain renouvellement"><input name="renewsAt" type="date" defaultValue={formatDateInput(row.renewsAt)} className={inputClass} /></Field></>}<Field label="Notes"><textarea name="notes" defaultValue={row.notes ?? ''} rows={2} className={inputClass} /></Field><label className="flex items-center gap-2 text-sm text-secondary"><input name="isActive" type="checkbox" defaultChecked={row.isActive && !row.isArchived} className="h-4 w-4 accent-accent" /> Client actif</label></Panel>
    <Panel className="space-y-4 p-5 lg:col-span-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Facturation électronique</p><p className="mt-1 text-sm text-secondary">Configuration indépendante de la formule IA.</p></div><span className={`cockpit-tag ${einvoicing.className}`}>{einvoicing.label}</span></div><div className="grid gap-4 md:grid-cols-3"><Field label="Mode"><select name="einvoicingMode" defaultValue={row.einvoicingConfig.mode} className={inputClass}>{EINVOICING_MODES.map((mode) => <option key={mode} value={mode}>{labelForEinvoicingMode(mode)}</option>)}</select></Field><Field label="Environnement"><select name="einvoicingEnvironment" defaultValue={row.einvoicingConfig.environment} className={inputClass}>{EINVOICING_ENVIRONMENTS.map((environment) => <option key={environment} value={environment}>{environment === 'sandbox' ? 'Test' : 'Production'}</option>)}</select></Field><Field label="Annuaire"><select name="einvoicingAnnuaireStatus" defaultValue={row.einvoicingConfig.annuaire_status} className={inputClass}>{EINVOICING_ANNUAIRE_STATUSES.map((status) => <option key={status} value={status}>{labelForAnnuaire(status)}</option>)}</select></Field></div><p className="text-xs text-secondary">{row.einvoicingConfig.oauth_status === 'connected' ? 'La connexion Super PDP est active.' : 'La connexion Super PDP n’est pas encore finalisée.'}</p><div className="border-t border-[var(--cockpit-line)] pt-4 text-xs leading-5 text-secondary"><p className="font-semibold text-primary">À quoi servent ces champs ?</p><p className="mt-2"><span className="font-medium text-primary">Factur-X :</span> le format natif des factures Atelier, quel que soit le mode choisi. Le mode pilote uniquement le circuit de transmission.</p><p className="mt-2"><span className="font-medium text-primary">Annuaire :</span> statut du référencement de l’entreprise (SIREN/SIRET) pour savoir si elle peut être identifiée et routée dans l’écosystème de facturation électronique. Dans cette version, le statut est suivi manuellement dans le cockpit ; la vérification automatique n’est pas encore branchée.</p><p className="mt-2"><span className="font-medium text-primary">Parcours actuel :</span> vérifie le référencement auprès de la plateforme concernée, choisis ici « En vérification », « Actif » ou « À vérifier », puis enregistre. La connexion Super PDP viendra ensuite.</p><p className="mt-2"><span className="font-medium text-primary">Non activée :</span> Factur-X reste le format produit, sans transmission électronique. <span className="font-medium text-primary">Dépôt manuel :</span> tu déposes le Factur-X sur la plateforme choisie. <span className="font-medium text-primary">Envoi automatisé :</span> connexion Super PDP prévue pour automatiser les échanges ; la transmission effective des factures reste à livrer.</p></div></Panel>
    <button type="submit" className="cockpit-button cockpit-button-dark lg:col-span-2">Enregistrer les changements</button>
  </ActionForm>
    <SetupActivationForm row={row} />
  </div>
}

function UsageTab({ row }: { row: ClientRow }) {
  const quotas = getLatestQuotaRows(row.quotas)
  return <div className="space-y-4"><Panel className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Consommation sur douze mois</p><p className="mt-1 text-sm text-secondary">Coût indicatif et coût réellement pris en charge par Orsayn.</p></div><span className="cockpit-tag"><Zap className="h-3.5 w-3.5" /> {row.monthEventCount} appels ce mois-ci</span></div><div className="mt-5"><UsageTrendChart history={row.usageHistory} /></div></Panel><Panel className="p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Forfaits de consommation</p><p className="mt-1 text-sm text-secondary">Les données restent historisées mois par mois.</p></div><span className="text-xs text-secondary">Dernier mois disponible</span></div>{quotas.length === 0 ? <p className="mt-5 text-sm text-secondary">Les quotas apparaîtront à la première synchronisation.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{quotas.map((quota) => { const current = normalizeNumber(quota.current_quantity); const monthly = normalizeNumber(quota.quota_monthly); const percent = monthly > 0 ? Math.min(100, (current / monthly) * 100) : monthly < 0 ? 0 : 100; return <div key={quota.quota_feature} className="border border-[var(--cockpit-line)] p-4"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-primary">{requireQuotaLabel(quota.quota_feature)}</span><span className={`cockpit-tag ${getQuotaBadgeClass(quota)}`}>{monthly < 0 ? 'Illimité' : `${Math.round((current / monthly) * 100)} %`}</span></div><div className="mt-3 h-1.5 bg-[rgb(var(--ink)/.10)]"><div className="h-full bg-accent" style={{ width: `${percent}%` }} /></div><div className="mt-2 flex justify-between text-xs text-secondary"><span>{formatQuotaValue(current)} / {formatQuotaValue(monthly)} {quota.quota_unit}</span><span>{formatMoney(normalizeNumber(quota.current_cost_eur))}</span></div><p className="mt-2 text-[11px] text-secondary">Période : {quota.period_start}</p></div> })}</div>}</Panel></div>
}

function requireQuotaLabel(feature: string) {
  // Le catalogue est la source unique des libellés visibles dans le CRM.
  return QUOTA_DEFINITIONS[feature as keyof typeof QUOTA_DEFINITIONS]?.label ?? 'Autre consommation IA'
}

function ModulesTab({ row }: { row: ClientRow }) {
  if (!row.organizationId || !row.isOrganizationResolved || row.organizationId === UNRESOLVED_ORGANIZATION_ID) return <Panel className="p-5"><p className="text-sm text-secondary">Cette fiche n’est pas encore reliée à une organisation réelle. Renseigne son organization ID dans l’onglet Offre, puis enregistre pour activer les modules.</p></Panel>
  const suggestedPack = getEligibleVerticalPack(row.businessActivityId)
  return <div className="grid items-stretch gap-5 xl:grid-cols-3"><ActionForm action={upsertOperatorClientModules} className="cockpit-panel flex h-full flex-col gap-6 p-6" successMessage="Modules mis à jour."><input type="hidden" name="sourceInstance" value={row.sourceInstance} /><input type="hidden" name="organizationId" value={row.organizationId} /><div><p className="text-lg font-semibold text-primary">Modules IA</p><p className="mt-2 text-sm leading-6 text-secondary">Active uniquement les fonctions prévues pour ce client.</p></div><div className="space-y-3">{ORGANIZATION_MODULE_KEYS.map((key) => <label key={key} className="flex items-center justify-between gap-3 border-b border-[var(--cockpit-line)] py-3.5 text-sm"><span className="text-primary">{MODULE_LABELS[key] ?? 'Fonction IA'}</span><input name={`module_${key}`} type="checkbox" defaultChecked={row.modules[key]} className="h-4 w-4 accent-accent" /></label>)}</div><button type="submit" className="cockpit-button cockpit-button-dark mt-auto w-full">Enregistrer les modules</button></ActionForm><ActionForm action={upsertOperatorClientVerticalPack} className="cockpit-panel flex h-full flex-col gap-6 p-6" successMessage="Pack métier mis à jour."><input type="hidden" name="sourceInstance" value={row.sourceInstance} /><input type="hidden" name="organizationId" value={row.organizationId} /><div><p className="text-lg font-semibold text-primary">Pack métier</p><p className="mt-2 text-sm leading-6 text-secondary">{suggestedPack && !row.businessVerticalPackId ? `Suggestion : ${suggestedPack.label}` : 'Adapte les repères de l’assistant au métier.'}</p></div><select name="vertical_pack_id" defaultValue={row.businessVerticalPackId ?? ''} className={inputClass}><option value="">Aucun pack</option>{Object.values(VERTICAL_PACKS).map((pack) => <option key={pack.id} value={pack.id}>{pack.label}</option>)}</select><button type="submit" className="cockpit-button cockpit-button-outline mt-auto w-full">Enregistrer le pack</button></ActionForm><ActionForm action={upsertOperatorClientMetalPricing} className="cockpit-panel flex h-full flex-col gap-6 p-6" successMessage="Option matière mise à jour."><input type="hidden" name="sourceInstance" value={row.sourceInstance} /><input type="hidden" name="organizationId" value={row.organizationId} /><div><p className="text-lg font-semibold text-primary">Prix des matières métal</p><p className="mt-2 text-sm leading-6 text-secondary">Option réservée aux activités métal.</p></div><label className="flex min-h-16 items-start gap-3 text-sm leading-6 text-primary"><input name="hasMetalPricing" type="checkbox" defaultChecked={row.hasMetalPricing} className="mt-1 h-4 w-4 accent-accent" /><span>Activer les prix matière et les repères de marge métal.</span></label><button type="submit" className="cockpit-button cockpit-button-outline mt-auto w-full">Enregistrer l’option</button></ActionForm></div>
}

function HistoryTab({ row }: { row: ClientRow }) {
  return <div className="grid gap-4 xl:grid-cols-2"><Panel className="p-5"><div className="flex items-center gap-2"><History className="h-4 w-4 text-accent" /><p className="text-lg font-semibold text-primary">Journal du dossier</p></div><div className="mt-4">{row.events.length === 0 ? <p className="text-sm text-secondary">Aucun événement enregistré.</p> : row.events.slice(0, 30).map((event) => <div key={event.id} className="border-b border-[var(--cockpit-line)] py-3 last:border-0"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-primary">{getEventLabel(event.event_type)}</p><span className="shrink-0 text-xs text-secondary">{formatDate(event.created_at)}</span></div><p className="mt-1 text-xs text-secondary">{event.actor_email ?? 'Automatique'}{event.notes ? ` · ${event.notes}` : ''}</p></div>)}</div></Panel><Panel className="p-5"><div className="flex items-center gap-2"><Mail className="h-4 w-4 text-accent" /><p className="text-lg font-semibold text-primary">Suivi commercial</p></div><div className="mt-4">{row.commercialEvents.length === 0 ? <p className="text-sm text-secondary">Aucune action commerciale enregistrée.</p> : row.commercialEvents.slice(0, 20).map((event) => <div key={event.id} className="border-b border-[var(--cockpit-line)] py-3 last:border-0"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-primary">{getCommercialEventLabel(event.event_type)}</p><span className="shrink-0 text-xs text-secondary">{formatDate(event.sent_at)}</span></div><p className="mt-1 text-xs text-secondary">{event.subject_preview ?? 'Sans objet'}{event.recipient_email ? ` · ${event.recipient_email}` : ''}</p></div>)}</div></Panel></div>
}

function LifecyclePanel({ row }: { row: ClientRow }) {
  const isSetup = row.billingModel === 'setup'
  const activeTrial = isActiveTrial(row.trialEndsAt) && !row.trialConverted
  const trialEnded = Boolean(row.trialEndsAt) && !activeTrial && !row.trialConverted
  const onboardingDone = row.onboardingStatus === 'completed'
  const onboardingDate = row.onboardingCompletedAt ?? row.onboardingStartedAt

  return <Panel className="space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-semibold text-primary">Cycle de vie</p><p className="mt-1 text-sm text-secondary">{isSetup ? 'Achat setup, accès Atelier et configuration du compte IA.' : 'Ce que le client voit avant, pendant et après son essai.'}</p></div><span className="cockpit-tag">{isSetup ? 'Achat setup' : getTrialLabel(row.trialEndsAt, row.trialConverted)}</span></div>
    <div className={`grid overflow-hidden border border-[var(--cockpit-line)] ${isSetup ? 'md:grid-cols-2' : 'md:grid-cols-4'}`}>
      <div className="relative border-b border-[var(--cockpit-line)] p-4 md:border-b-0 md:border-r"><div className={`flex h-8 w-8 items-center justify-center rounded-full ${onboardingDone ? 'bg-[rgb(var(--success)/.12)] text-success' : 'bg-[rgb(var(--warning)/.12)] text-warning'}`}>{onboardingDone ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</div><p className="mt-3 text-sm font-semibold text-primary">1. Onboarding</p><p className="mt-1 text-xs leading-5 text-secondary">{formatOnboardingStatus(row.onboardingStatus)}{onboardingDate ? ` · ${formatDate(onboardingDate)}` : ''}</p></div>
      {isSetup ? (
        <div className="p-4"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--success)/.12)] text-success"><Database className="h-4 w-4" /></div><p className="mt-3 text-sm font-semibold text-primary">2. Achat setup</p><p className="mt-1 text-xs leading-5 text-secondary">3 000 € HT réglés en une fois. Accès hors abonnement.</p></div>
      ) : (
        <>
          <div className="border-b border-[var(--cockpit-line)] p-4 md:border-b-0 md:border-r"><div className={`flex h-8 w-8 items-center justify-center rounded-full ${activeTrial ? 'bg-[rgb(var(--accent)/.12)] text-accent' : 'bg-[rgb(var(--ink)/.08)] text-secondary'}`}><Zap className="h-4 w-4" /></div><p className="mt-3 text-sm font-semibold text-primary">2. Essai Pro</p><p className="mt-1 text-xs leading-5 text-secondary">{row.trialEndsAt ? `${activeTrial ? 'Actif jusqu’au' : 'Terminé le'} ${formatDate(row.trialEndsAt)}` : 'Pas encore démarré'}</p></div>
          <div className="border-b border-[var(--cockpit-line)] p-4 md:border-b-0 md:border-r"><div className={`flex h-8 w-8 items-center justify-center rounded-full ${trialEnded ? 'bg-[rgb(var(--warning)/.12)] text-warning' : 'bg-[rgb(var(--ink)/.08)] text-secondary'}`}><Clock3 className="h-4 w-4" /></div><p className="mt-3 text-sm font-semibold text-primary">3. À l’échéance</p><p className="mt-1 text-xs leading-5 text-secondary">Accès Pro mis en pause. Aucun prélèvement automatique.</p></div>
          <div className="p-4"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--ink)/.08)] text-secondary"><Database className="h-4 w-4" /></div><p className="mt-3 text-sm font-semibold text-primary">4. Après l’essai</p><p className="mt-1 text-xs leading-5 text-secondary">Données conservées. Relances automatiques à J+3 et J+10.</p></div>
        </>
      )}
    </div>
    <div className="border border-[var(--cockpit-line)] bg-[var(--cockpit-paper)] px-4 py-3"><p className="text-sm font-semibold text-primary">{isSetup ? 'Achat setup activé' : trialEnded ? 'Essai terminé : l’espace reste récupérable' : activeTrial && row.trialEndsAt ? `Le ${formatDate(row.trialEndsAt)}, l’accès Pro sera mis en pause` : 'Aucun abonnement ne démarre automatiquement'}</p><p className="mt-1 text-xs leading-5 text-secondary">{isSetup ? 'L’accès Atelier reste hors abonnement récurrent. La consommation IA est imputée au compte OpenRouter du client.' : 'Le client n’est pas débité. Ses données restent disponibles et il peut activer une formule pour reprendre là où il s’est arrêté.'}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="border border-[var(--cockpit-line)] p-3"><p className="cockpit-eyebrow">Configuration</p><p className="mt-2 text-sm font-medium text-primary">{formatSyncStatus(row.configSyncStatus)}</p>{row.configSyncError && <p className="mt-1 text-xs text-danger">{row.configSyncError}</p>}</div><div className="border border-[var(--cockpit-line)] p-3"><p className="cockpit-eyebrow">Accès actuel</p><p className="mt-2 text-sm font-medium text-primary">{row.isArchived ? 'Fiche archivée' : row.isActive ? 'Actif' : 'Inactif'}</p><p className="mt-1 text-xs text-secondary">{isSetup ? 'Achat setup' : row.accessStatus === 'trialing' ? 'Essai en cours' : row.accessStatus === 'expired' ? 'Accès Pro en pause' : 'Accès géré par la formule'}</p></div></div>
    {row.isOrganizationResolved && <ActionForm action={resyncOperatorClientConfig} successMessage="Configuration renvoyée."><input type="hidden" name="sourceInstance" value={row.sourceInstance} />{row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}<button type="submit" className="cockpit-button cockpit-button-outline w-full"><RotateCcw className="h-4 w-4" /> Renvoyer la configuration</button></ActionForm>}
    {!isSetup && <div className="border-t border-[var(--cockpit-line)] pt-4"><div className="flex flex-wrap gap-2">{!activeTrial && onboardingDone && <ActionForm action={activateOperatorTrial} successMessage="Essai Pro activé."><input type="hidden" name="sourceInstance" value={row.sourceInstance} />{row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}<button type="submit" className="cockpit-button cockpit-button-dark"><Zap className="h-4 w-4" /> {trialEnded ? 'Réactiver 7 jours Pro' : 'Activer 7 jours Pro'}</button></ActionForm>}{activeTrial && <><ActionForm action={extendOperatorTrial} successMessage="Essai prolongé de 7 jours."><input type="hidden" name="sourceInstance" value={row.sourceInstance} />{row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}<button type="submit" className="cockpit-button cockpit-button-outline">+7 jours</button></ActionForm><ActionForm action={convertOperatorTrial} successMessage="Essai converti."><input type="hidden" name="sourceInstance" value={row.sourceInstance} />{row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}<select name="targetTier" defaultValue="pro" className="cockpit-input"><option value="pro">Pro</option><option value="expert">Expert</option></select><button type="submit" className="cockpit-button cockpit-button-dark">Convertir</button></ActionForm><ActionForm action={expireOperatorTrial} successMessage="Essai terminé et accès réduit."><input type="hidden" name="sourceInstance" value={row.sourceInstance} />{row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}<input type="hidden" name="targetTier" value="setup_only" /><button type="submit" className="cockpit-button cockpit-button-danger">Terminer l’essai</button></ActionForm></>}</div></div>}
  </Panel>
}

function DangerZone({ row }: { row: ClientRow }) {
  const [confirming, setConfirming] = useState(false)
  const isSetup = row.billingModel === 'setup'

  return (
    <Panel className="border-danger/30 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <p className="font-semibold text-primary">Zone sensible</p>
          <p className="mt-1 text-sm text-secondary">
            {isSetup
              ? 'Archiver masque la fiche du cockpit sans retirer la preuve de paiement.'
              : 'Archiver masque la fiche tout en conservant son historique. La suppression retire la configuration, l’offre et les quotas du cockpit opérateur.'}
          </p>
          {isSetup && <p className="mt-1 text-sm text-secondary">La suppression définitive est désactivée pour cet achat.</p>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {row.isArchived ? (
          <ActionForm action={restoreOperatorClient} successMessage="Fiche restaurée.">
            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
            <input type="hidden" name="organizationId" value={row.organizationId ?? ''} />
            <button type="submit" className="cockpit-button cockpit-button-outline"><RotateCcw className="h-4 w-4" /> Désarchiver</button>
          </ActionForm>
        ) : (
          <ActionForm action={archiveOperatorClient} successMessage="Fiche archivée.">
            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
            <input type="hidden" name="organizationId" value={row.organizationId ?? ''} />
            <button type="submit" className="cockpit-button cockpit-button-outline"><Archive className="h-4 w-4" /> Archiver la fiche</button>
          </ActionForm>
        )}
        {!isSetup && <button type="button" onClick={() => setConfirming((value) => !value)} className="cockpit-button cockpit-button-danger"><Trash2 className="h-4 w-4" /> Supprimer la fiche</button>}
      </div>
      {!isSetup && confirming && (
        <div className="mt-4 border-t border-danger/20 pt-4">
          <p className="text-sm font-medium text-danger">Cette action est définitive pour le cockpit. Saisis « {row.label} » pour confirmer.</p>
          <ActionForm action={deleteOperatorClient} className="mt-3 flex flex-col gap-3 sm:flex-row" successMessage="Fiche supprimée." successHref="/orsayn/clients">
            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
            <input type="hidden" name="organizationId" value={row.organizationId ?? ''} />
            <input type="hidden" name="expectedName" value={row.label} />
            <input name="confirmName" required className={`${inputClass} sm:max-w-sm`} placeholder={row.label} />
            <button type="submit" className="cockpit-button cockpit-button-danger">Confirmer la suppression</button>
          </ActionForm>
        </div>
      )}
    </Panel>
  )
}

export default function ClientDetail({ row }: { row: ClientRow }) {
  const [activeTab, setActiveTab] = useState<DetailTab>('offer')
  const sync = getSyncBadge(row.lastSeenAt, row.lastStatus)
  const einvoicing = getEinvoicingBadge(row.einvoicingConfig)
  return <main className="cockpit-shell"><header className="cockpit-header"><div className="flex min-w-0 items-start gap-3"><Link href="/orsayn/clients" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--cockpit-line)] text-secondary hover:text-primary"><ArrowLeft className="h-4 w-4" /></Link><div className="min-w-0"><p className="cockpit-kicker">Fiche client</p><h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-primary sm:text-4xl">{row.label}</h1><p className="mt-2 flex items-center gap-2 text-sm text-secondary"><UserRound className="h-4 w-4" />{row.contactEmail ?? 'Aucun contact renseigné'} <ChevronRight className="h-3.5 w-3.5" /> {formatClientOffer(row)}</p></div></div><div className="flex flex-wrap items-center gap-2"><span className={`cockpit-tag ${sync.className}`}>{sync.label}</span><span className={`cockpit-tag ${einvoicing.className}`}>{einvoicing.label}</span></div></header><Panel className="p-5 sm:p-6"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Forfait mensuel" value={row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)} /><Stat label="Coût IA du mois" value={formatMoney(row.monthCostEur)} hint={row.aiBillingMode === 'client_owned' ? 'Clé du client' : 'Pris en charge'} /><Stat label="Marge brute" value={row.grossMarginEur === null ? 'À compléter' : formatMoney(row.grossMarginEur)} /><Stat label="Taux de marge" value={row.marginPct === null ? 'À compléter' : `${row.marginPct.toFixed(1)} %`} /><Stat label="Dernière activité" value={formatDate(row.lastSeenAt)} /></div></Panel><LifecyclePanel row={row} /><nav aria-label="Sections de la fiche" className="flex gap-1 overflow-x-auto border-b border-[var(--cockpit-line)]">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition ${activeTab === id ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>{activeTab === 'offer' && <OfferTab row={row} />}{activeTab === 'usage' && <UsageTab row={row} />}{activeTab === 'modules' && <ModulesTab row={row} />}{activeTab === 'history' && <HistoryTab row={row} />}<DangerZone row={row} /></main>
}
