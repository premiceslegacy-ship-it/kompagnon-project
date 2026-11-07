'use client'
// @atelier-migrated
// Onboarding : une vue par étape (voir useOnboarding pour l'état).

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ChevronRight, ClipboardPaste, FileUp, Mic } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Switch } from '@/components/ui/Switch'
import { AuthLayout } from '@/components/auth/AuthLayout'
import {
  AuthCenter, AuthError, AuthFields, AuthLinkButton, AuthNote, AuthSection, AuthSubmit, AuthSuccessMark,
} from '@/components/auth/AuthParts'
import formStyles from '@/components/auth/Auth.module.css'
import { APP_NAME } from '@/lib/brand'
import { JOB_TITLE_SUGGESTIONS, formatJoinCode } from '@/lib/auth-ui'
import { completeOnboarding, joinViaCode, skipInvites } from './actions'
import ActivityPicker from './ActivityPicker'
import { CompleteFields, LaunchFields } from './OnboardingFields'
import { stepProgress, welcomeTitle } from './onboardingModel'
import type { OnboardingState } from './useOnboarding'
import styles from './Onboarding.module.css'

export function WelcomeStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout hideLogo title={welcomeTitle(q.firstName)} subtitle="Votre compte est prêt. Comment souhaitez-vous continuer ?">
      <ListGroup>
        <ListRow
          title="Je crée mon entreprise"
          description="Devis, chantiers et clients au même endroit."
          trailing={<ChevronRight size={20} className={styles.chevron} aria-hidden="true" />}
          onClick={() => q.setStep(1)}
        />
        <ListRow
          title="Je rejoins une entreprise"
          description="Avec le code donné par votre responsable."
          trailing={<ChevronRight size={20} className={styles.chevron} aria-hidden="true" />}
          onClick={() => q.setStep('join')}
        />
      </ListGroup>
    </AuthLayout>
  )
}

export function CompanyStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout
      onBack={() => q.setStep(0)}
      steps={stepProgress(1)}
      title="Votre entreprise"
      subtitle="Ces infos apparaîtront sur vos documents."
    >
      <div className={formStyles.form}>
        <AuthFields>
          <Field
            type="text"
            label="Nom"
            required
            autoComplete="organization"
            placeholder="Dupont Rénovation"
            value={q.companyName}
            onChange={(event) => q.changeCompanyName(event.target.value)}
          />
        </AuthFields>
        <AuthError>{q.fieldErrors.name}</AuthError>
        <ActivityPicker q={q} />
        <AuthSubmit disabled={!q.companyName.trim() || !q.selectedActivity} onClick={q.submitCompany}>
          Continuer
        </AuthSubmit>
      </div>
    </AuthLayout>
  )
}

export function ContactStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout
      onBack={() => q.setStep(1)}
      steps={stepProgress(2)}
      title="Ouvrons votre espace"
      subtitle="Deux informations, puis vous obtenez votre premier résultat avec Sarah."
    >
      <form
        className={formStyles.form}
        onSubmit={(event) => {
          event.preventDefault()
          q.submitContact()
        }}
      >
        <AuthFields>
          <Field
            type="text"
            inputType="email"
            label="Email"
            required
            autoComplete="email"
            placeholder="contact@entreprise.fr"
            value={q.email}
            error={q.fieldErrors.email}
            onChange={(event) => q.changeEmail(event.target.value)}
          />
          <Field
            type="text"
            label="SIRET"
            required={q.selfService}
            inputMode="numeric"
            autoComplete="off"
            placeholder="123 456 789 00012"
            value={q.siret}
            error={q.fieldErrors.siret}
            onChange={(event) => q.changeSiret(event.target.value)}
          />
        </AuthFields>
        <AuthNote>
          Le SIRET complète vos mentions légales sur les devis et les factures. Le logo, l’adresse, la TVA, le RIB, la signature et l’équipe restent disponibles dans les réglages.
        </AuthNote>
        <AuthSubmit>Continuer</AuthSubmit>
      </form>
    </AuthLayout>
  )
}

const FIRST_RESULTS = [
  { icon: Mic, title: 'Dicter', detail: 'Parlez comme sur le chantier.' },
  { icon: ClipboardPaste, title: 'Coller', detail: 'Un email ou un message client.' },
  { icon: FileUp, title: 'Importer', detail: 'PDF, photo, plan ou CCTP.' },
]

export function LaunchStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout hideLogo onBack={() => q.setStep(2)} title="Votre espace est prêt" subtitle="On prépare votre premier devis ?">
      <AuthSuccessMark />
      <form action={skipInvites} className={formStyles.form}>
        <LaunchFields q={q} />
        <ListGroup description="Comptez environ 2 minutes. Le logo, le RIB et la signature pourront être complétés plus tard dans les réglages.">
          {FIRST_RESULTS.map(({ icon: Icon, title, detail }) => (
            <ListRow key={title} title={title} description={detail} leading={<Icon size={20} className={styles.lead} aria-hidden="true" />} />
          ))}
        </ListGroup>
        <AuthSubmit name="onboarding_destination" value="atelier-ia" pendingLabel="Ouverture…">
          Créer mon premier devis
        </AuthSubmit>
      </form>
      <AuthCenter>
        <AuthLinkButton quiet onClick={() => q.setStep(3)}>
          Passer cette étape
        </AuthLinkButton>
      </AuthCenter>
    </AuthLayout>
  )
}

export function EinvoicingStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout
      onBack={() => q.setStep('launch')}
      steps={stepProgress(3)}
      title="Factures électroniques"
      subtitle="La loi impose ce nouveau format à toutes les entreprises françaises, progressivement."
    >
      <div className={formStyles.form}>
        <ListGroup description="Recevoir est obligatoire depuis le 1er septembre 2026 pour toutes les entreprises ; émettre le sera à partir du 1er septembre 2027. Vous pourrez changer ces choix dans les réglages, quand vous serez prêt à connecter votre compte.">
          <ListRow
            title="Recevoir les factures de mes fournisseurs"
            description="Elles arrivent directement dans Documents, sans ressaisie."
            trailing={
              <Switch
                checked={q.einvoicingWantsReception}
                onChange={(next) => (next ? q.setEinvoicingWantsReception(true) : q.refuseReceptionOff())}
                label="Recevoir les factures de mes fournisseurs par ce nouveau format"
              />
            }
          />
          <ListRow
            title="Envoyer mes propres factures"
            description="Vos factures partent au format Factur-X."
            trailing={
              <Switch
                checked={q.einvoicingWantsEmission}
                onChange={q.setEinvoicingWantsEmission}
                label="Envoyer mes propres factures dans ce nouveau format"
              />
            }
          />
        </ListGroup>
        <AuthSubmit onClick={() => q.setStep(4)}>
          Continuer
        </AuthSubmit>
      </div>
      <AlertDialog
        open={q.showReceptionInfo}
        onOpenChange={q.setShowReceptionInfo}
        title="Vous restez libre, mais la loi s'applique"
        description="Recevoir les factures de vos fournisseurs dans ce format est une obligation légale depuis le 1er septembre 2026, pour toutes les entreprises, sans exception. Ne pas l'activer ici ne vous dispense pas de cette obligation : vous pourrez toujours changer d'avis plus tard dans vos réglages."
        confirmLabel="Désactiver"
        cancelLabel="Garder activé"
        onConfirm={q.confirmReceptionOff}
      />
    </AuthLayout>
  )
}

function CopyCodeRow({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return <ListRow title={copied ? 'Code copié' : 'Copier le code'} className={styles.copyRow} onClick={() => void copy()} />
}

function SkipInvites() {
  const { pending } = useFormStatus()
  return (
    <div className={styles.skip}>
      <AuthLinkButton type="submit" quiet formAction={skipInvites} disabled={pending}>
        Passer cette étape
      </AuthLinkButton>
    </div>
  )
}

export function TeamStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout
      onBack={() => q.setStep(3)}
      steps={stepProgress(4)}
      title="Inviter votre équipe"
      subtitle="Optionnel, vous pourrez le faire plus tard."
    >
      <form action={completeOnboarding} className={formStyles.form}>
        <CompleteFields q={q} />
        {q.joinCode && (
          <ListGroup
            title="Code entreprise"
            description="Pour les équipes nombreuses : vos collaborateurs rejoignent directement à leur inscription avec ce code, sans invitation individuelle."
          >
            <ListRow title={q.joinCode} className={styles.code} />
            <CopyCodeRow code={q.joinCode} />
          </ListGroup>
        )}
        {q.roles.length > 0 && (
          <AuthSection title="Invitation par email">
            <div className={styles.inviteStack}>
              {q.invites.map((invite, index) => (
                <div key={index}>
                  <AuthFields>
                    <Field
                      type="text"
                      inputType="email"
                      label="Email"
                      name={`invite_email_${index}`}
                      placeholder="prenom@entreprise.fr"
                      value={invite.email}
                      onChange={(event) => q.updateInvite(index, 'email', event.target.value)}
                    />
                    <Field
                      type="select"
                      label="Rôle"
                      name={`invite_role_${index}`}
                      value={invite.roleId}
                      onChange={(event) => q.updateInvite(index, 'roleId', event.target.value)}
                    >
                      {q.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Field>
                  </AuthFields>
                  {q.invites.length > 1 && (
                    <div className={styles.removeRow}>
                      <AuthLinkButton quiet onClick={() => q.removeInvite(index)}>
                        Retirer
                      </AuthLinkButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div>
              <AuthLinkButton quiet onClick={q.addInvite}>
                Ajouter une personne
              </AuthLinkButton>
            </div>
          </AuthSection>
        )}
        <AuthError>{q.hasInvalidEmail ? 'Certaines adresses email ne sont pas valides.' : q.errorMsg}</AuthError>
        <AuthSubmit pendingLabel="Chargement…" disabled={q.hasInvalidEmail}>
          Démarrer {APP_NAME}
        </AuthSubmit>
        <SkipInvites />
      </form>
    </AuthLayout>
  )
}

export function JoinStep({ q }: { q: OnboardingState }) {
  return (
    <AuthLayout onBack={() => q.setStep(0)} title="Rejoindre une entreprise" subtitle="Saisissez le code fourni par votre responsable.">
      <form action={joinViaCode} className={formStyles.form}>
        <AuthFields>
          <Field
            type="text"
            label="Code"
            name="join_code"
            required
            maxLength={8}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="EX : FTR-28K4"
            value={q.codeInput}
            onChange={(event) => q.setCodeInput(formatJoinCode(event.target.value))}
          />
          <Field type="text" label="Poste" name="job_title" list="join-job-titles" placeholder="Ex : Chef de chantier" />
        </AuthFields>
        <datalist id="join-job-titles">
          {JOB_TITLE_SUGGESTIONS.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
        <AuthNote>Le poste est facultatif.</AuthNote>
        <AuthError>{q.errorMsg}</AuthError>
        <AuthSubmit pendingLabel="Connexion…">Rejoindre</AuthSubmit>
      </form>
    </AuthLayout>
  )
}
