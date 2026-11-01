'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Clipboard, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  createOperatorSetupHermesBrief,
  loadOperatorSetupIntake,
  saveOperatorSetupIntake,
} from './setup-intake-actions'
import {
  areSetupIntakeDraftsEqual,
  isSetupIntakeTarget,
  SETUP_INTAKE_MATERIAL_CATEGORIES,
  SETUP_INTAKE_MAX_MATERIALS,
  SETUP_INTAKE_SOURCE,
  setupIntakeDraftFromRecord,
  type SetupIntakeDraft,
  type SetupIntakeLoadResult,
  type SetupIntakeMaterial,
  type SetupIntakeMaterialCategory,
  type SetupIntakeRecord,
} from './setup-intake-domain'
import type { ClientRow } from './types'
import { formatSyncStatus } from './utils'

type Props = {
  row: ClientRow
  initialResult: SetupIntakeLoadResult
}

type Feedback = { kind: 'error' | 'success' | 'info'; message: string } | null

type LoadState = SetupIntakeLoadResult | { status: 'loading' }

const inputClass = 'cockpit-input w-full'
const materialCategoryLabels: Record<SetupIntakeMaterialCategory, string> = {
  document: 'Document',
  tableur: 'Tableur',
  photo: 'Photo',
  export: 'Export',
  autre: 'Autre',
}

function emptyDraft(row: ClientRow): SetupIntakeDraft {
  return {
    sourceInstance: SETUP_INTAKE_SOURCE,
    organizationId: row.organizationId ?? '',
    expectedRevision: 0,
    firstValueGoal: '',
    firstValueAcceptance: '',
    scopeIncluded: '',
    scopeExcluded: '',
    decisionOwnerRole: '',
    targetDate: null,
    expectedMaterials: [],
    blockers: '',
    nextAction: '',
    scopeValidated: false,
  }
}

function draftForRecord(row: ClientRow, record: SetupIntakeRecord | null): SetupIntakeDraft {
  return record ? setupIntakeDraftFromRecord(record) : emptyDraft(row)
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="cockpit-label">{label}</span>{children}{hint && <span className="mt-1 block text-xs leading-5 text-secondary">{hint}</span>}</label>
}

function unavailableForRow(row: ClientRow): string | null {
  if (row.sourceInstance !== SETUP_INTAKE_SOURCE) {
    return 'Le dossier est réservé à l’application partagée Atelier (source atelier-app). Cette fiche ne peut pas recevoir ce dossier.'
  }
  if (!row.isOrganizationResolved || !isSetupIntakeTarget(row.sourceInstance, row.organizationId)) {
    return 'Aucun dossier n’est chargé. Renseignez puis vérifiez l’UUID réel de l’organisation Atelier dans l’onglet Offre. Aucun identifiant par défaut n’est utilisé.'
  }
  if (row.billingModel !== 'setup') {
    return 'Le dossier est réservé aux achats setup activés dans le cockpit. L’attestation du règlement et l’activation restent dans le formulaire existant de l’onglet Offre.'
  }
  return null
}


export default function SetupIntakeDossier({ row, initialResult }: Props) {
  const [loadState, setLoadState] = useState<LoadState>(initialResult)
  const [record, setRecord] = useState<SetupIntakeRecord | null>(initialResult.status === 'ready' ? initialResult.record : null)
  const [draft, setDraft] = useState<SetupIntakeDraft>(() => draftForRecord(row, initialResult.status === 'ready' ? initialResult.record : null))
  const [pendingAction, setPendingAction] = useState<'load' | 'save' | 'brief' | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [conflicted, setConflicted] = useState(false)
  const [hermesBrief, setHermesBrief] = useState('')
  const [briefCopied, setBriefCopied] = useState(false)
  const rowUnavailable = unavailableForRow(row)
  const baseline = draftForRecord(row, record)
  const dirty = !areSetupIntakeDraftsEqual(draft, baseline)
  const ready = loadState.status === 'ready' && !rowUnavailable

  function updateDraft(next: SetupIntakeDraft) {
    setDraft(next)
    setFeedback(null)
    setHermesBrief('')
    setBriefCopied(false)
  }

  function updateScopeDraft(next: SetupIntakeDraft) {
    updateDraft({ ...next, scopeValidated: false })
  }


  function updateMaterial(index: number, patch: Partial<SetupIntakeMaterial>) {
    const expectedMaterials = draft.expectedMaterials.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    updateScopeDraft({ ...draft, expectedMaterials })
  }

  async function handleReload() {
    if (dirty && !window.confirm('Recharger remplace les modifications non enregistrées. Continuer ?')) return
    setPendingAction('load')
    setLoadState({ status: 'loading' })
    setFeedback(null)
    setHermesBrief('')
    setBriefCopied(false)
    try {
      const result = await loadOperatorSetupIntake(row.sourceInstance, row.organizationId)
      setLoadState(result)
      if (result.status === 'ready') {
        setRecord(result.record)
        setDraft(draftForRecord(row, result.record))
        setConflicted(false)
        setFeedback({ kind: 'success', message: 'Version enregistrée rechargée.' })
      } else {
        setFeedback({ kind: 'error', message: result.message })
      }
    } catch {
      const result = { status: 'error', message: 'Le dossier n’a pas pu être rechargé. Vérifiez la connexion puis réessayez.' } as const
      setLoadState(result)
      setFeedback({ kind: 'error', message: result.message })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isSetupIntakeTarget(row.sourceInstance, row.organizationId) || row.billingModel !== 'setup' || conflicted) return
    setPendingAction('save')
    setFeedback(null)
    setHermesBrief('')
    setBriefCopied(false)
    const payload = {
      ...draft,
      sourceInstance: row.sourceInstance,
      organizationId: row.organizationId,
      expectedRevision: record?.revision ?? 0,
    }
    try {
      const result = await saveOperatorSetupIntake(payload)
      if (!result.ok) {
        setFeedback({ kind: 'error', message: result.message })
        if (result.reason === 'conflict') setConflicted(true)
        return
      }
      setRecord(result.value)
      setDraft(setupIntakeDraftFromRecord(result.value))
      setLoadState({ status: 'ready', record: result.value })
      setConflicted(false)
      setFeedback({
        kind: 'success',
        message: result.value.scopeValidated
          ? `Dossier enregistré. Le périmètre est attesté en interne par ${result.value.scopeValidatedBy} le ${new Date(result.value.scopeValidatedAt!).toLocaleString('fr-FR')}.`
          : 'Brouillon enregistré. Le périmètre reste à valider en interne.',
      })
    } catch {
      setFeedback({ kind: 'error', message: 'L’enregistrement a échoué. Vos valeurs restent dans le formulaire.' })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCreateBrief() {
    if (!record?.scopeValidated || dirty || !isSetupIntakeTarget(row.sourceInstance, row.organizationId)) return
    setPendingAction('brief')
    setFeedback(null)
    setHermesBrief('')
    setBriefCopied(false)
    try {
      const result = await createOperatorSetupHermesBrief(row.sourceInstance, row.organizationId)
      if (!result.ok) {
        setFeedback({ kind: 'error', message: result.message })
        return
      }
      setHermesBrief(result.value)
      setFeedback({ kind: 'success', message: 'Brief préparé à partir de la version enregistrée et validée.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Le brief Hermes n’a pas pu être préparé. Rechargez la fiche avant de réessayer.' })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCopyBrief() {
    if (!hermesBrief) return
    try {
      await navigator.clipboard.writeText(hermesBrief)
      setBriefCopied(true)
      setFeedback({ kind: 'success', message: 'Brief copié. Aucun message n’a été envoyé.' })
    } catch {
      setFeedback({ kind: 'info', message: 'La copie automatique est indisponible. Sélectionnez le texte dans la zone puis copiez-le.' })
    }
  }

  function addMaterial() {
    if (draft.expectedMaterials.length >= SETUP_INTAKE_MAX_MATERIALS) return
    updateScopeDraft({
      ...draft,
      expectedMaterials: [...draft.expectedMaterials, { label: '', category: 'document', count: 1, reference: '' }],
    })
  }

  function removeMaterial(index: number) {
    updateScopeDraft({ ...draft, expectedMaterials: draft.expectedMaterials.filter((_, itemIndex) => itemIndex !== index) })
  }
  const loadMessage = loadState.status === 'loading'
    ? 'Chargement du dossier de mise en place.'
    : loadState.status === 'ready'
      ? ''
      : loadState.message
  const accessLabel = row.isArchived ? 'Fiche archivée' : row.isActive ? 'Actif' : 'Inactif'

  return (
    <section className="space-y-4" aria-labelledby="setup-intake-title">
      <div className="cockpit-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="setup-intake-title" className="text-lg font-semibold text-primary">Dossier de mise en place</h2>
            <p className="mt-1 text-sm leading-6 text-secondary">Préparez le premier résultat, son critère d’acceptation et les éléments nécessaires au démarrage du setup.</p>
            <p className="mt-2 text-xs text-secondary">Cible du dossier : <code className="break-all text-primary">{row.sourceInstance} · {row.organizationId ?? 'organisation non résolue'}</code></p>
          </div>
          <span className="cockpit-tag">Suivi interne</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="border border-[var(--cockpit-line)] p-3"><p className="cockpit-eyebrow">Offre</p><p className="mt-2 text-sm font-medium text-primary">{row.billingModel === 'setup' ? 'Achat setup activé dans le cockpit' : 'Achat setup non activé'}</p><p className="mt-1 text-xs leading-5 text-secondary">L’attestation du règlement reste dans « Offre ». Le dossier n’enregistre aucune preuve de paiement.</p></div>
          <div className="border border-[var(--cockpit-line)] p-3"><p className="cockpit-eyebrow">Accès actuel</p><p className="mt-2 text-sm font-medium text-primary">{accessLabel}{row.accessStatus ? ` · ${row.accessStatus}` : ''}</p><p className="mt-1 text-xs leading-5 text-secondary">État lu depuis la fiche client du cockpit.</p></div>
          <div className="border border-[var(--cockpit-line)] p-3"><p className="cockpit-eyebrow">Synchronisation de configuration</p><p className="mt-2 text-sm font-medium text-primary">{formatSyncStatus(row.configSyncStatus)}</p>{row.configSyncError && <p className="mt-1 text-xs leading-5 text-danger">{row.configSyncError}</p>}</div>
        </div>
      </div>

      {rowUnavailable ? (
        <div className="cockpit-panel p-5" role="status"><p className="text-sm leading-6 text-secondary">{rowUnavailable}</p></div>
      ) : loadState.status === 'loading' ? (
        <div className="cockpit-panel flex items-center gap-2 p-5 text-sm text-secondary" role="status"><Loader2 className="h-4 w-4 animate-spin" />{loadMessage}</div>
      ) : loadState.status !== 'ready' ? (
        <div className="cockpit-panel space-y-3 p-5" role="alert"><div className="flex items-start gap-2 text-sm text-primary"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" /><p>{loadMessage}</p></div>{pendingAction !== 'load' && <button type="button" onClick={handleReload} className="cockpit-button cockpit-button-outline"><RefreshCw className="h-4 w-4" />Recharger le dossier</button>}</div>
      ) : (
        <>
          {record ? (
            <p role="status" className="cockpit-panel p-4 text-sm leading-6 text-secondary">
              Version {record.revision} enregistrée le {new Date(record.updatedAt).toLocaleString('fr-FR')} par {record.updatedBy}.{' '}
              {record.scopeValidated
                ? `Périmètre validé en interne le ${new Date(record.scopeValidatedAt!).toLocaleString('fr-FR')} par ${record.scopeValidatedBy}.`
                : 'Brouillon sauvegardé ; le périmètre reste à valider en interne.'}
            </p>
          ) : (
            <p role="status" className="cockpit-panel p-4 text-sm leading-6 text-secondary">
              Aucun dossier n’a encore été enregistré. Les valeurs ci-dessous ne sont pas sauvegardées avant la première action « Enregistrer ».
            </p>
          )}
          <form onSubmit={handleSave} className="space-y-4">
            <fieldset disabled={pendingAction !== null} className="contents">
            <section className="cockpit-panel space-y-4 p-5" aria-labelledby="setup-first-value-title">
              <div><h3 id="setup-first-value-title" className="text-base font-semibold text-primary">Premier résultat attendu</h3><p className="mt-1 text-sm text-secondary">Décrivez un résultat que l’équipe et le client pourront examiner, puis son critère de validation.</p></div>
              <Field label="Premier résultat utile" hint="600 caractères maximum."><textarea value={draft.firstValueGoal} maxLength={600} rows={3} className={inputClass} onChange={(event) => updateScopeDraft({ ...draft, firstValueGoal: event.currentTarget.value })} /></Field>
              <Field label="Critère d’acceptation" hint="Indiquez ce qui permettra de constater que ce premier résultat répond au besoin."><textarea value={draft.firstValueAcceptance} maxLength={600} rows={3} className={inputClass} onChange={(event) => updateScopeDraft({ ...draft, firstValueAcceptance: event.currentTarget.value })} /></Field>
            </section>

            <section className="cockpit-panel space-y-4 p-5" aria-labelledby="setup-scope-title">
              <div><h3 id="setup-scope-title" className="text-base font-semibold text-primary">Périmètre convenu</h3><p className="mt-1 text-sm text-secondary">La date cible est un repère interne de planification, pas une promesse contractuelle.</p></div>
              <Field label="Inclus dans le setup"><textarea value={draft.scopeIncluded} maxLength={1200} rows={4} className={inputClass} onChange={(event) => updateScopeDraft({ ...draft, scopeIncluded: event.currentTarget.value })} /></Field>
              <Field label="Exclusions et limites"><textarea value={draft.scopeExcluded} maxLength={1200} rows={4} className={inputClass} onChange={(event) => updateScopeDraft({ ...draft, scopeExcluded: event.currentTarget.value })} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Rôle de la personne qui décide" hint="L’adresse de contact existante vient de la fiche client."><input value={draft.decisionOwnerRole} maxLength={160} className={inputClass} onChange={(event) => updateScopeDraft({ ...draft, decisionOwnerRole: event.currentTarget.value })} /></Field>
                <Field label="Date cible interne"><input type="date" value={draft.targetDate ?? ''} className={inputClass} onChange={(event) => updateDraft({ ...draft, targetDate: event.currentTarget.value || null })} /></Field>
              </div>
              <p className="text-sm text-secondary">Contact enregistré dans la fiche : <span className="font-medium text-primary">{row.contactEmail ?? 'aucun email renseigné'}</span></p>
            </section>

            <section className="cockpit-panel space-y-4 p-5" aria-labelledby="setup-inventory-title">
              <div><h3 id="setup-inventory-title" className="text-base font-semibold text-primary">Matériel source attendu</h3><p className="mt-1 text-sm leading-6 text-secondary">Inventaire de métadonnées uniquement : libellé, catégorie, nombre et référence interne. Aucun fichier ni lien ne peut être déposé ici. N’inscrivez aucun secret, mot de passe, jeton, donnée de paie, numéro NIR ou donnée de santé.</p></div>
              {draft.expectedMaterials.length === 0 && <p className="border border-[var(--cockpit-line)] p-4 text-sm text-secondary">Aucun élément de source n’est listé. Ajoutez uniquement les catégories et quantités attendues.</p>}
              <div className="space-y-3">
                {draft.expectedMaterials.map((item, index) => (
                  <div key={index} className="space-y-3 border border-[var(--cockpit-line)] p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-primary">Élément {index + 1}</p><button type="button" aria-label={`Retirer l’élément ${index + 1}`} onClick={() => removeMaterial(index)} className="cockpit-button cockpit-button-outline"><Trash2 className="h-4 w-4" />Retirer</button></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Libellé"><input value={item.label} maxLength={100} className={inputClass} onChange={(event) => updateMaterial(index, { label: event.currentTarget.value })} /></Field>
                      <Field label="Catégorie"><select value={item.category} className={inputClass} onChange={(event) => updateMaterial(index, { category: event.currentTarget.value as SetupIntakeMaterialCategory })}>{SETUP_INTAKE_MATERIAL_CATEGORIES.map((category) => <option key={category} value={category}>{materialCategoryLabels[category]}</option>)}</select></Field>
                      <Field label="Nombre attendu"><input type="number" min={1} max={999} step={1} value={Number.isNaN(item.count) ? '' : item.count} className={inputClass} onChange={(event) => updateMaterial(index, { count: event.currentTarget.value === '' ? Number.NaN : Number(event.currentTarget.value) })} /></Field>
                      <Field label="Référence interne" hint="Un nom ou identifiant interne, sans chemin ni URL."><input value={item.reference} maxLength={120} className={inputClass} onChange={(event) => updateMaterial(index, { reference: event.currentTarget.value })} /></Field>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addMaterial} disabled={draft.expectedMaterials.length >= SETUP_INTAKE_MAX_MATERIALS} className="cockpit-button cockpit-button-outline"><Plus className="h-4 w-4" />Ajouter un élément</button>
            </section>

            <section className="cockpit-panel space-y-4 p-5" aria-labelledby="setup-next-step-title">
              <div><h3 id="setup-next-step-title" className="text-base font-semibold text-primary">Blocages et prochaine action</h3><p className="mt-1 text-sm text-secondary">Notez ce qui empêche le démarrage et la prochaine action humaine attendue.</p></div>
              <Field label="Blocages actuels"><textarea value={draft.blockers} maxLength={600} rows={3} className={inputClass} onChange={(event) => updateDraft({ ...draft, blockers: event.currentTarget.value })} /></Field>
              <Field label="Prochaine action"><textarea value={draft.nextAction} maxLength={600} rows={3} className={inputClass} onChange={(event) => updateDraft({ ...draft, nextAction: event.currentTarget.value })} /></Field>
              <label className="flex items-start gap-3 border border-[var(--cockpit-line)] p-4 text-sm text-primary">
                <input type="checkbox" checked={draft.scopeValidated} className="mt-0.5 h-4 w-4 accent-accent" onChange={(event) => updateDraft({ ...draft, scopeValidated: event.currentTarget.checked })} />
                <span><span className="font-medium">Je confirme que le périmètre ci-dessus a été revu et validé en interne.</span><span className="mt-1 block text-xs leading-5 text-secondary">Cette attestation humaine date la validation du périmètre. Elle ne prouve ni paiement, ni import, ni livraison.</span></span>
              </label>
            </section>

            {record && dirty && record.scopeValidated && <p className="cockpit-panel p-4 text-sm text-secondary" role="status">La version enregistrée est validée. Les modifications visibles ici ne sont pas enregistrées et ne font pas partie de cette attestation.</p>}
            {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className="flex items-start gap-2 text-sm text-primary">{feedback.kind === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : feedback.kind === 'error' ? <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : null}{feedback.message}</p>}
            {conflicted && <div className="cockpit-panel space-y-2 p-4" role="alert"><p className="text-sm text-secondary">Les valeurs locales sont conservées, mais l’enregistrement est suspendu pour éviter d’écraser la version plus récente.</p><button type="button" onClick={handleReload} disabled={pendingAction !== null} className="cockpit-button cockpit-button-outline"><RefreshCw className="h-4 w-4" />Recharger la version enregistrée</button></div>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={pendingAction !== null || conflicted || !ready} className="cockpit-button cockpit-button-dark">{pendingAction === 'save' ? <><Loader2 className="h-4 w-4 animate-spin" />Enregistrement en cours</> : draft.scopeValidated ? 'Enregistrer et valider le périmètre' : 'Enregistrer le brouillon'}</button>
              <p className="text-xs leading-5 text-secondary">L’enregistrement ne déclenche aucun paiement, import, resynchronisation ou appel externe.</p>
            </div>
            </fieldset>
          </form>

          <section className="cockpit-panel space-y-3 p-5" aria-labelledby="setup-hermes-title">
            <div><h3 id="setup-hermes-title" className="text-base font-semibold text-primary">Brief de préparation pour Hermes</h3><p className="mt-1 text-sm leading-6 text-secondary">Le brief est généré côté serveur depuis la version enregistrée et validée. Les modifications non enregistrées en sont exclues. Hermes prépare et normalise les éléments pour un seul organisme, sans importer ni agir sur le paiement, les accès ou les identifiants.</p></div>
            <button type="button" onClick={handleCreateBrief} disabled={!record?.scopeValidated || dirty || pendingAction !== null} className="cockpit-button cockpit-button-outline"><Clipboard className="h-4 w-4" />{pendingAction === 'brief' ? 'Préparation du brief' : 'Préparer le brief Hermes'}</button>
            {record?.scopeValidated && !dirty && <p className="text-xs text-secondary">Version enregistrée {record.revision}, validée le {new Date(record.scopeValidatedAt!).toLocaleString('fr-FR')} par {record.scopeValidatedBy}.</p>}
            {!record?.scopeValidated && <p className="text-xs text-secondary">Validez et enregistrez le périmètre avant de préparer un brief.</p>}
            {hermesBrief && <>
              <label className="block"><span className="cockpit-label">Brief JSON prêt à copier</span><textarea readOnly rows={16} value={hermesBrief} className={`${inputClass} font-mono text-xs`} onFocus={(event) => event.currentTarget.select()} /></label>
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={handleCopyBrief} className="cockpit-button cockpit-button-outline"><Clipboard className="h-4 w-4" />{briefCopied ? 'Brief copié' : 'Copier le brief'}</button><p className="text-xs text-secondary">Le brief reste dans cette fiche. Aucun contenu n’est envoyé.</p></div>
            </>}
          </section>
        </>
      )}
    </section>
  )
}
