'use client'
// @atelier-migrated
// Onboarding : état et gestes du parcours (aucun affichage ici).

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  normalizeSecondaryActivityIds,
  resolveBusinessSelection,
  type BusinessActivityId,
  type BusinessProfile,
} from '@/lib/catalog-context'
import { formatSiretInput, type OrganizationFieldErrors } from '@/lib/validations/organization'
import type { OrgRole } from '@/lib/data/queries/roles'
import {
  ONBOARDING_ERRORS,
  PRIORITY_FAMILIES,
  addInviteRow,
  hasErrors,
  hasInvalidInviteEmail,
  initialStepForError,
  removeInviteRow,
  updateInviteRow,
  validateCompany,
  validateContact,
  type InviteRow,
  type OnboardingStep,
} from './onboardingModel'

export type OnboardingInput = {
  firstName: string | null
  initialEmail: string | null
  roles: OrgRole[]
  joinCode: string | null
  selfService: boolean
}

export function useOnboarding({ firstName, initialEmail, roles: allRoles, joinCode, selfService }: OnboardingInput) {
  // Le rôle dirigeant ne s'attribue jamais par invitation (refusé par la base).
  const roles = allRoles.filter(role => role.slug !== 'owner')
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const errorMsg = errorKey ? ONBOARDING_ERRORS[errorKey] ?? null : null

  const [step, setStep] = useState<OnboardingStep>(() => initialStepForError(errorKey))

  // Dirigeant
  const [companyName, setCompanyName] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<BusinessActivityId | ''>('')
  const [selectedSecondaryActivities, setSelectedSecondaryActivities] = useState<BusinessActivityId[]>([])
  const [showSecondaryActivities, setShowSecondaryActivities] = useState<Partial<Record<BusinessProfile, boolean>>>({})
  // Liste complète (21 activités) au lieu des 5 familles prioritaires : demandée par
  // « Autre activité », ou imposée si l'activité déjà choisie n'est dans aucune famille.
  const [showOtherActivities, setShowOtherActivities] = useState(false)
  const [siret, setSiret] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  // Intention exprimée avant toute connexion : n'active rien, sert à afficher un
  // rappel ciblé (la connexion se fait plus tard depuis les Réglages).
  const [einvoicingWantsReception, setEinvoicingWantsReception] = useState(true)
  const [einvoicingWantsEmission, setEinvoicingWantsEmission] = useState(false)
  const [showReceptionInfo, setShowReceptionInfo] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<OrganizationFieldErrors>({})
  const defaultRoleId = roles.find(role => role.slug === 'collaborateur')?.id ?? roles[0]?.id ?? ''
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', roleId: defaultRoleId }])

  // Collaborateur
  const [codeInput, setCodeInput] = useState('')

  const resolvedSelection = selectedActivity ? resolveBusinessSelection({ activityId: selectedActivity }) : null
  const pickerShowsAll =
    showOtherActivities ||
    Boolean(selectedActivity && !PRIORITY_FAMILIES.some((family) => family.activityIds.includes(selectedActivity)))

  function clearFieldError(field: keyof OrganizationFieldErrors) {
    setFieldErrors((previous) => {
      if (!(field in previous)) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function selectActivity(activityId: BusinessActivityId) {
    setSelectedActivity(activityId)
    setSelectedSecondaryActivities((previous) => normalizeSecondaryActivityIds(previous, activityId))
    clearFieldError('name')
  }

  function changeCompanyName(value: string) {
    setCompanyName(value)
    clearFieldError('name')
  }

  function changeEmail(value: string) {
    setEmail(value)
    clearFieldError('email')
  }

  function changeSiret(value: string) {
    setSiret(formatSiretInput(value))
    clearFieldError('siret')
  }

  function submitCompany() {
    const errors = validateCompany({ companyName, activity: selectedActivity })
    setFieldErrors(errors)
    if (!hasErrors(errors)) setStep(2)
  }

  function submitContact() {
    const errors = validateContact({ email, siret, selfService })
    setFieldErrors(errors)
    if (!hasErrors(errors)) setStep('launch')
  }

  function refuseReceptionOff() {
    setShowReceptionInfo(true)
  }

  function confirmReceptionOff() {
    setEinvoicingWantsReception(false)
    setShowReceptionInfo(false)
  }

  return {
    step, setStep, errorMsg,
    companyName, changeCompanyName,
    selectedActivity, selectedSecondaryActivities, selectActivity,
    showSecondaryActivities, setShowSecondaryActivities,
    setShowOtherActivities, pickerShowsAll, resolvedSelection,
    siret, changeSiret, email, changeEmail,
    einvoicingWantsReception, setEinvoicingWantsReception,
    einvoicingWantsEmission, setEinvoicingWantsEmission,
    showReceptionInfo, setShowReceptionInfo, refuseReceptionOff, confirmReceptionOff,
    fieldErrors, submitCompany, submitContact,
    roles, defaultRoleId, joinCode, selfService,
    invites,
    addInvite: () => setInvites((previous) => addInviteRow(previous, defaultRoleId)),
    removeInvite: (index: number) => setInvites((previous) => removeInviteRow(previous, index)),
    updateInvite: (index: number, field: keyof InviteRow, value: string) =>
      setInvites((previous) => updateInviteRow(previous, index, field, value)),
    hasInvalidEmail: hasInvalidInviteEmail(invites),
    codeInput, setCodeInput,
    firstName,
  }
}

export type OnboardingState = ReturnType<typeof useOnboarding>
