'use client'

import { useState, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import {
  Building2, Users, ArrowRight, Loader2,
  CheckCircle2, AlertCircle, Plus, Trash2, Copy, Check, KeyRound, Upload, ImageIcon,
  ChevronDown, MapPin, Landmark, CreditCard,
} from 'lucide-react'
import { completeOnboarding, skipInvites, joinViaCode } from './actions'
import type { OrgRole } from '@/lib/data/queries/roles'
import { createClient } from '@/lib/supabase/client'
import {
  BUSINESS_ACTIVITIES_BY_PROFILE,
  getSecondaryActivityOptions,
  normalizeSecondaryActivityIds,
  resolveBusinessSelection,
  type BusinessActivityId,
  type BusinessProfile,
} from '@/lib/catalog-context'
import { LegalFooter } from '@/components/legal/LegalFooter'
import { APP_NAME } from '@/lib/brand'
import {
  formatBicInput,
  formatIbanInput,
  formatPostalCodeInput,
  formatSirenInput,
  formatSiretInput,
  formatVatNumberInput,
  normalizeBic,
  normalizeEmail,
  normalizeFrenchIban,
  normalizeFrenchVatNumber,
  normalizePostalCode,
  normalizeSiret,
  type OrganizationFieldErrors,
} from '@/lib/validations/organization'
import { LEGAL_VAT_RATES } from '@/lib/utils'

const inputCls =
  'w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] focus:border-accent/50 focus:ring-1 focus:ring-accent/20 rounded-xl text-white text-sm outline-none transition-all placeholder:text-white/20'

const JOB_TITLES = [
  { value: 'commercial',        label: 'Commercial' },
  { value: 'administratif',     label: 'Administratif' },
  { value: 'chef_de_chantier',  label: 'Chef de chantier' },
  { value: 'technicien',        label: 'Technicien' },
  { value: 'autre',             label: 'Autre' },
]

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields:    'Veuillez remplir tous les champs obligatoires.',
  org_not_found:     'Votre espace de travail est introuvable. Veuillez vous reconnecter.',
  org_update_failed: 'La mise à jour de votre espace a échoué. Veuillez réessayer.',
  invalid_org_details: 'Certaines informations entreprise doivent être corrigées avant de continuer.',
  invalid_code:      'Code entreprise introuvable. Vérifiez le code et réessayez.',
  join_failed:       "Une erreur est survenue lors de la connexion à l'entreprise. Veuillez réessayer.",
}

type InviteRow = { email: string; roleId: string }

// Étapes owner : 0=welcome, 1=company, 2=contact, 3=legal, 4=payment, 5=team
// Étape joiner : 0=welcome, 'join'=code
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 'join'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement…
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="w-4 h-4" />
        </>
      )}
    </button>
  )
}

type Props = { firstName: string | null; initialEmail: string | null; roles: OrgRole[]; joinCode: string | null }

export default function OnboardingClient({ firstName, initialEmail, roles, joinCode }: Props) {
  const [step, setStep] = useState<Step>(0)

  // Owner state
  const [companyName, setCompanyName] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<BusinessActivityId | ''>('')
  const [selectedSecondaryActivities, setSelectedSecondaryActivities] = useState<BusinessActivityId[]>([])
  const [openActivityProfile, setOpenActivityProfile] = useState<BusinessProfile>('btp')
  const [showSecondaryActivities, setShowSecondaryActivities] = useState<Partial<Record<BusinessProfile, boolean>>>({})
  const [siret, setSiret] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  const [formeJuridique, setFormeJuridique] = useState('')
  const [capitalSocial, setCapitalSocial] = useState('')
  const [rcs, setRcs] = useState('')
  const [rcsVille, setRcsVille] = useState('')
  const [isVatSubject, setIsVatSubject] = useState(true)
  const [defaultVatRate, setDefaultVatRate] = useState(20)
  const [iban, setIban] = useState('')
  const [bic, setBic] = useState('')
  const [bankName, setBankName] = useState('')
  const [paymentTermsDays, setPaymentTermsDays] = useState(30)
  const [latePenaltyRate, setLatePenaltyRate] = useState(3)
  const [courtCompetent, setCourtCompetent] = useState('')
  const [fieldErrors, setFieldErrors] = useState<OrganizationFieldErrors>({})
  const defaultRoleId = roles[0]?.id ?? ''
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', roleId: defaultRoleId }])

  // Logo state
  const [logoUrl, setLogoUrl] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const ext = file.name.split('.').pop()
      const path = `${user.id}/logo.${ext}`
      const { error } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
      if (!error) {
        const { data } = supabase.storage.from('logos').getPublicUrl(path)
        setLogoUrl(data.publicUrl)
      }
    } finally {
      setLogoUploading(false)
    }
  }

  // Joiner state
  const [codeInput, setCodeInput] = useState('')
  const [selectedJobTitle, setSelectedJobTitle] = useState('')
  const [customJobTitle, setCustomJobTitle] = useState('')

  // Code copy state
  const [copied, setCopied] = useState(false)

  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const errorMsg = errorKey ? ERROR_MESSAGES[errorKey] : null

  const name = firstName ?? 'vous'
  const resolvedSelection = selectedActivity ? resolveBusinessSelection({ activityId: selectedActivity }) : null

  function addInvite() {
    setInvites((prev) => [...prev, { email: '', roleId: defaultRoleId }])
  }
  function removeInvite(index: number) {
    setInvites((prev) => prev.filter((_, i) => i !== index))
  }
  function updateInvite(index: number, field: keyof InviteRow, value: string) {
    setInvites((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function copyCode() {
    if (!joinCode) return
    navigator.clipboard.writeText(joinCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasInvalidEmail = invites.some(
    (inv) => inv.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email.trim())
  )

  function setFieldError(field: keyof OrganizationFieldErrors, error?: string) {
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (error) next[field] = error
      else delete next[field]
      return next
    })
  }

  function validateCompanyStep() {
    const nextErrors: OrganizationFieldErrors = {}
    if (!companyName.trim()) nextErrors.name = "Le nom de l'entreprise est obligatoire."
    if (!selectedActivity) nextErrors.name = nextErrors.name ?? 'Choisissez une activité de référence.'
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function validateContactStep() {
    const nextErrors: OrganizationFieldErrors = {}
    const normalizedEmail = normalizeEmail(email)
    const normalizedPostalCode = normalizePostalCode(postalCode)
    if (!email.trim()) nextErrors.email = "L'email de contact est obligatoire."
    else if (normalizedEmail.error) nextErrors.email = normalizedEmail.error
    if (normalizedPostalCode.error) nextErrors.postal_code = normalizedPostalCode.error
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function validateLegalStep() {
    const nextErrors: OrganizationFieldErrors = {}
    const normalizedSiret = normalizeSiret(siret)
    const normalizedVat = normalizeFrenchVatNumber(vatNumber)
    if (normalizedSiret.error) nextErrors.siret = normalizedSiret.error
    if (isVatSubject && normalizedVat.error) nextErrors.vat_number = normalizedVat.error
    if (!LEGAL_VAT_RATES.includes(defaultVatRate as typeof LEGAL_VAT_RATES[number])) {
      nextErrors.default_vat_rate = 'Choisissez un taux de TVA légal.'
    }
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function validatePaymentStep() {
    const nextErrors: OrganizationFieldErrors = {}
    const normalizedIban = normalizeFrenchIban(iban)
    const normalizedBic = normalizeBic(bic)
    if (normalizedIban.error) nextErrors.iban = normalizedIban.error
    if (normalizedBic.error) nextErrors.bic = normalizedBic.error
    if (!Number.isFinite(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 90) {
      nextErrors.payment_terms_days = 'Le délai doit être compris entre 0 et 90 jours.'
    }
    if (!Number.isFinite(latePenaltyRate) || latePenaltyRate < 0 || latePenaltyRate > 100) {
      nextErrors.late_penalty_rate = 'Le taux doit être compris entre 0 et 100 %.'
    }
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function FieldError({ field }: { field: keyof OrganizationFieldErrors }) {
    if (!fieldErrors[field]) return null
    return <p className="text-xs text-danger/90">{fieldErrors[field]}</p>
  }

  function ActivityAccordion() {
    return (
      <div className="space-y-2">
        {(Object.entries(BUSINESS_ACTIVITIES_BY_PROFILE) as Array<[BusinessProfile, typeof BUSINESS_ACTIVITIES_BY_PROFILE[BusinessProfile]]>).map(([profileKey, activities]) => {
          const profile = resolveBusinessSelection({ businessProfile: profileKey }).profileConfig
          const open = openActivityProfile === profileKey
          const selectedInProfile = activities.some((activity) => activity.id === selectedActivity)
          const tier1 = activities.filter((a) => a.tier === 1)
          const tier2 = activities.filter((a) => a.tier === 2)
          const showSecondary = showSecondaryActivities[profileKey] ?? false
          const selectedIsSecondary = tier2.some((a) => a.id === selectedActivity)
          const visibleActivities = showSecondary || selectedIsSecondary ? activities : tier1
          return (
            <div key={profileKey} className="rounded-xl border border-white/[0.08] bg-white/[0.035] overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenActivityProfile(profileKey)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-white/75">{profile.onboardingLabel}</span>
                  {selectedInProfile && (
                    <span className="mt-0.5 block text-xs text-accent">
                      {activities.find((activity) => activity.id === selectedActivity)?.label}
                    </span>
                  )}
                </span>
                <ChevronDown className={`w-4 h-4 text-white/35 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  {visibleActivities.map((activity) => (
                    <button
                      key={activity.id}
                      type="button"
                      onClick={() => {
                        setSelectedActivity(activity.id)
                        setSelectedSecondaryActivities((prev) => normalizeSecondaryActivityIds(prev, activity.id))
                        setOpenActivityProfile(profileKey)
                        setFieldError('name')
                      }}
                      className={`w-full px-4 py-3 rounded-xl text-left transition-all border ${
                        selectedActivity === activity.id
                          ? 'bg-accent/15 border-accent/40 text-accent'
                          : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.07] hover:text-white/70'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{activity.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed opacity-80">{activity.description}</span>
                    </button>
                  ))}
                  {tier2.length > 0 && !showSecondary && !selectedIsSecondary && (
                    <button
                      type="button"
                      onClick={() => setShowSecondaryActivities((prev) => ({ ...prev, [profileKey]: true }))}
                      className="w-full py-2 text-xs text-white/35 hover:text-white/55 transition-colors text-center"
                    >
                      Voir d'autres activités ({tier2.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function SecondaryActivitiesPicker({
    currentActivityId,
    selected,
    onChange,
  }: {
    currentActivityId: BusinessActivityId
    selected: BusinessActivityId[]
    onChange: (next: BusinessActivityId[]) => void
  }) {
    const others = getSecondaryActivityOptions(currentActivityId)
    return (
      <div className="space-y-2">
        <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
          Vous faites aussi
        </label>
        <div className="flex flex-wrap gap-2">
          {others.map((a) => {
            const checked = selected.includes(a.id)
            const cls = checked
              ? 'bg-accent/15 border-accent/40 text-accent'
              : 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white/60 hover:border-white/20'
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(checked ? selected.filter((id) => id !== a.id) : [...selected, a.id])}
                className={'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ' + cls}
              >
                {a.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-white/30">Optionnel — aide Sarah à mieux contextualiser vos devis.</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start sm:justify-center bg-[#050505] text-white overflow-y-auto font-body p-4 sm:p-6 pt-8 sm:pt-6">
      {/* Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-accent/[0.08] rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-accent/[0.04] rounded-full blur-[120px] pointer-events-none" />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 mb-10">
        <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-glow-accent overflow-hidden">
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
          ) : companyName ? (
            <span className="text-black font-extrabold text-sm">
              {companyName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          ) : (
            <span className="text-black font-extrabold text-sm">A</span>
          )}
        </div>
        <span className="text-lg font-extrabold tracking-tight font-display">
          {companyName || APP_NAME}
        </span>
      </div>

      {/* Step dots */}
      <div className="relative z-10 flex items-center gap-2 mb-8">
        {(step === 'join' ? [0, 1] : [0, 1, 2, 3, 4, 5]).map((_, i) => {
          const currentIdx = step === 'join' ? 1 : (step as number)
          return (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === currentIdx ? 'w-6 bg-accent' : i < currentIdx ? 'w-3 bg-accent/50' : 'w-3 bg-white/10'
              }`}
            />
          )
        })}
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-lg">
        <div className="bg-white/[0.04] backdrop-blur-[40px] border border-white/[0.08] rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10">

          {/* Erreur URL */}
          {errorMsg && step !== 0 && (
            <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-xs text-danger/90 leading-snug">{errorMsg}</p>
            </div>
          )}

          {/* ── STEP 0 : Bienvenue ── */}
          {step === 0 && (
            <div className="flex flex-col items-center text-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-accent" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-display">Bienvenue, {name}&nbsp;!</h1>
                <p className="mt-2 text-sm text-white/45 leading-relaxed max-w-xs mx-auto">
                  Votre compte est prêt. Comment souhaitez-vous continuer ?
                </p>
              </div>

              <div className="w-full space-y-3">
                <button
                  onClick={() => setStep(1)}
                  className="w-full py-3.5 px-5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent flex items-center justify-between gap-3"
                >
                  <Building2 className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-center">Je crée mon entreprise</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
                <button
                  onClick={() => setStep('join')}
                  className="w-full py-3.5 px-5 rounded-pill bg-white/[0.06] border border-white/[0.10] text-white font-bold text-sm hover:bg-white/[0.10] active:scale-[0.99] transition-all flex items-center justify-between gap-3"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-center">Je rejoins une entreprise</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 1 : Entreprise (owner) ── */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Votre entreprise</h2>
                  <p className="text-xs text-white/40">Ces infos apparaîtront sur vos documents.</p>
                </div>
              </div>

              <div className="space-y-5">

                {/* Logo upload */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Logo <span className="ml-1 normal-case tracking-normal text-white/25 font-normal">(optionnel)</span>
                  </label>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={logoUploading}
                    className="flex items-center gap-3 px-4 py-3 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-accent/40 hover:bg-white/[0.07] transition-all disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.06] flex items-center justify-center">
                      {logoPreview ? (
                        <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-white/30" />
                      )}
                    </div>
                    <span className="text-sm text-white/50 flex items-center gap-2">
                      {logoUploading ? <><Loader2 className="w-4 h-4 animate-spin" />Envoi en cours…</> :
                       logoPreview ? <><Upload className="w-4 h-4" />Changer le logo</> :
                       <><Upload className="w-4 h-4" />Importer un logo</>}
                    </span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Nom de l&apos;entreprise <span className="text-accent">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="organization"
                    placeholder="Dupont Rénovation"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value)
                      setFieldError('name')
                    }}
                    className={inputCls}
                  />
                  <FieldError field="name" />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Activité de référence <span className="text-accent">*</span>
                  </label>
                  <ActivityAccordion />
                  <p className="text-xs text-white/35">
                    Choisissez l’activité qui correspond le mieux à votre entreprise. Vous pourrez ensuite chiffrer plusieurs types de prestations.
                  </p>
                </div>

                {selectedActivity && (
                  <SecondaryActivitiesPicker
                    currentActivityId={selectedActivity}
                    selected={selectedSecondaryActivities}
                    onChange={setSelectedSecondaryActivities}
                  />
                )}

                <div className="pt-1">
                  <button
                    type="button"
                    disabled={!companyName.trim() || !selectedActivity}
                    onClick={() => {
                      if (validateCompanyStep()) setStep(2)
                    }}
                    className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    Continuer
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => setStep(0)}
                className="mt-4 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors"
              >
                Retour
              </button>
            </div>
          )}

          {/* ── STEP 2 : Coordonnées (owner) ── */}
          {step === 2 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Coordonnées</h2>
                  <p className="text-xs text-white/40">Ces infos seront reprises sur vos devis et factures.</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Email de contact <span className="text-accent">*</span>
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="contact@entreprise.fr"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setFieldError('email')
                    }}
                    className={inputCls}
                  />
                  <FieldError field="email" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Téléphone</label>
                  <input type="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Adresse</label>
                  <input type="text" autoComplete="street-address" placeholder="12 rue de la Paix" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={inputCls} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Code postal</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="69007"
                      value={postalCode}
                      onChange={(e) => {
                        setPostalCode(formatPostalCodeInput(e.target.value))
                        setFieldError('postal_code')
                      }}
                      className={`${inputCls} tabular-nums`}
                    />
                    <FieldError field="postal_code" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Ville</label>
                    <input type="text" autoComplete="address-level2" placeholder="Lyon" value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (validateContactStep()) setStep(3)
                    }}
                    className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent flex items-center justify-center gap-2"
                  >
                    Continuer
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button onClick={() => setStep(1)} className="mt-4 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors">Retour</button>
            </div>
          )}

          {/* ── STEP 3 : Légal & TVA (owner) ── */}
          {step === 3 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Landmark className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Légal &amp; TVA</h2>
                  <p className="text-xs text-white/40">Renseignez maintenant ce que vous avez sous la main.</p>
                </div>
              </div>
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">SIRET</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="123 456 789 00012"
                      value={siret}
                      onChange={(e) => {
                        setSiret(formatSiretInput(e.target.value))
                        setFieldError('siret')
                      }}
                      className={`${inputCls} tabular-nums`}
                    />
                    <FieldError field="siret" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">TVA intracom.</label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="FR12 123 456 789"
                      value={vatNumber}
                      onChange={(e) => {
                        setVatNumber(formatVatNumberInput(e.target.value))
                        setFieldError('vat_number')
                      }}
                      className={`${inputCls} tabular-nums`}
                      disabled={!isVatSubject}
                    />
                    <FieldError field="vat_number" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Forme juridique</label>
                    <input type="text" placeholder="SAS, SARL, EI..." value={formeJuridique} onChange={(e) => setFormeJuridique(e.target.value)} className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Capital social</label>
                    <input type="text" placeholder="10 000 €" value={capitalSocial} onChange={(e) => setCapitalSocial(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">N° RCS</label>
                    <input type="text" placeholder="123 456 789" value={rcs} onChange={(e) => setRcs(formatSirenInput(e.target.value))} className={`${inputCls} tabular-nums`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Ville RCS</label>
                    <input type="text" placeholder="Paris" value={rcsVille} onChange={(e) => setRcsVille(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Régime TVA</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button type="button" onClick={() => setIsVatSubject(true)} className={`p-3 rounded-xl border text-left ${isVatSubject ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/[0.04] border-white/[0.08] text-white/50'}`}>Assujetti à la TVA</button>
                    <button type="button" onClick={() => setIsVatSubject(false)} className={`p-3 rounded-xl border text-left ${!isVatSubject ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-white/[0.04] border-white/[0.08] text-white/50'}`}>Franchise en base</button>
                  </div>
                  {isVatSubject && (
                    <select value={defaultVatRate} onChange={(e) => setDefaultVatRate(Number(e.target.value))} className={inputCls}>
                      <option className="bg-[#111]" value={20}>20 % : taux normal</option>
                      <option className="bg-[#111]" value={10}>10 % : rénovation</option>
                      <option className="bg-[#111]" value={5.5}>5,5 % : énergétique</option>
                    </select>
                  )}
                </div>
                <button type="button" onClick={() => { if (validateLegalStep()) setStep(4) }} className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent flex items-center justify-center gap-2">Continuer<ArrowRight className="w-4 h-4" /></button>
              </div>
              <button onClick={() => setStep(2)} className="mt-4 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors">Retour</button>
            </div>
          )}

          {/* ── STEP 4 : Paiement (owner) ── */}
          {step === 4 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Paiement &amp; RIB</h2>
                  <p className="text-xs text-white/40">Formatage automatique, correction immédiate.</p>
                </div>
              </div>
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">IBAN</label>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="FR76 3000 6000 0112 3456 7890 189"
                    value={iban}
                    onChange={(e) => {
                      setIban(formatIbanInput(e.target.value))
                      setFieldError('iban')
                    }}
                    className={`${inputCls} font-mono tracking-wider`}
                  />
                  <FieldError field="iban" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">BIC / SWIFT</label>
                    <input type="text" placeholder="BNPAFRPPXXX" value={bic} onChange={(e) => { setBic(formatBicInput(e.target.value)); setFieldError('bic') }} className={`${inputCls} font-mono tracking-wider`} />
                    <FieldError field="bic" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Banque</label>
                    <input type="text" placeholder="BNP Paribas" value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Délai paiement</label>
                    <input type="number" min={0} max={90} value={paymentTermsDays} onChange={(e) => { setPaymentTermsDays(Number(e.target.value)); setFieldError('payment_terms_days') }} className={`${inputCls} tabular-nums`} />
                    <FieldError field="payment_terms_days" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Pénalités (%)</label>
                    <input type="number" min={0} max={100} step={0.01} value={latePenaltyRate} onChange={(e) => { setLatePenaltyRate(Number(e.target.value)); setFieldError('late_penalty_rate') }} className={`${inputCls} tabular-nums`} />
                    <FieldError field="late_penalty_rate" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">Tribunal compétent</label>
                  <input type="text" placeholder="Paris" value={courtCompetent} onChange={(e) => setCourtCompetent(e.target.value)} className={inputCls} />
                  <p className="text-xs text-white/35">Tapez juste la ville, Atelier complètera la mention.</p>
                </div>
                <button type="button" onClick={() => { if (validatePaymentStep()) setStep(5) }} className="w-full py-3.5 rounded-pill bg-accent text-black font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all shadow-glow-accent flex items-center justify-center gap-2">Continuer<ArrowRight className="w-4 h-4" /></button>
              </div>
              <button onClick={() => setStep(3)} className="mt-4 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors">Retour</button>
            </div>
          )}

          {/* ── STEP 5 : Invitations (owner) ── */}
          {step === 5 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Inviter votre équipe</h2>
                  <p className="text-xs text-white/40">Optionnel, vous pourrez le faire plus tard.</p>
                </div>
              </div>

              {/* Code entreprise */}
              {joinCode && (
                <div className="mb-6 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                  <p className="text-[11px] font-semibold tracking-widest uppercase text-white/35 mb-2">
                    Code entreprise
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold tracking-widest font-mono text-accent">
                      {joinCode}
                    </span>
                    <button
                      type="button"
                      onClick={copyCode}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/50 hover:text-white transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copié !' : 'Copier'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-white/30 leading-snug">
                    Pour les équipes nombreuses, partagez ce code : vos collaborateurs pourront rejoindre directement à leur inscription, sans invitation individuelle.
                  </p>
                </div>
              )}

              <form action={completeOnboarding} className="space-y-5">
                <input type="hidden" name="company_name" value={companyName} />
                <input type="hidden" name="business_activity" value={selectedActivity} />
                <input type="hidden" name="secondary_activity_ids" value={JSON.stringify(selectedSecondaryActivities)} />
                <input type="hidden" name="business_profile" value={resolvedSelection?.businessProfile ?? ''} />
                <input
                  type="hidden"
                  name="sector"
                  value={resolvedSelection?.sectorLabel ?? ''}
                />
                <input type="hidden" name="siret" value={siret} />
                <input type="hidden" name="vat_number" value={vatNumber} />
                <input type="hidden" name="email" value={email} />
                <input type="hidden" name="phone" value={phone} />
                <input type="hidden" name="address_line1" value={addressLine1} />
                <input type="hidden" name="postal_code" value={postalCode} />
                <input type="hidden" name="city" value={city} />
                <input type="hidden" name="forme_juridique" value={formeJuridique} />
                <input type="hidden" name="capital_social" value={capitalSocial} />
                <input type="hidden" name="rcs" value={rcs} />
                <input type="hidden" name="rcs_ville" value={rcsVille} />
                <input type="hidden" name="is_vat_subject" value={isVatSubject ? 'true' : 'false'} />
                <input type="hidden" name="default_vat_rate" value={defaultVatRate} />
                <input type="hidden" name="iban" value={iban} />
                <input type="hidden" name="bic" value={bic} />
                <input type="hidden" name="bank_name" value={bankName} />
                <input type="hidden" name="payment_terms_days" value={paymentTermsDays} />
                <input type="hidden" name="late_penalty_rate" value={latePenaltyRate} />
                <input type="hidden" name="court_competent" value={courtCompetent} />
                <input type="hidden" name="logo_url" value={logoUrl} />

                {roles.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                      Invitation par email
                    </p>
                    {invites.map((inv, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <input
                          type="email"
                          name={`invite_email_${i}`}
                          placeholder="collegue@email.com"
                          value={inv.email}
                          onChange={(e) => updateInvite(i, 'email', e.target.value)}
                          className={`${inputCls} flex-1`}
                        />
                        <select
                          name={`invite_role_${i}`}
                          value={inv.roleId}
                          onChange={(e) => updateInvite(i, 'roleId', e.target.value)}
                          className="px-3 py-3 bg-white/[0.06] border border-white/[0.08] focus:border-accent/50 rounded-xl text-white text-sm outline-none transition-all"
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id} className="bg-[#111]">
                              {r.name}
                            </option>
                          ))}
                        </select>
                        {invites.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeInvite(i)}
                            className="p-3 rounded-xl text-white/30 hover:text-danger/70 hover:bg-danger/10 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addInvite}
                      className="flex items-center gap-1.5 text-xs text-white/35 hover:text-accent transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter une personne
                    </button>
                  </div>
                )}

                {hasInvalidEmail && (
                  <p className="text-xs text-danger/80">Certaines adresses email ne sont pas valides.</p>
                )}

                <div className="pt-1 space-y-2">
                  <SubmitButton label={`Démarrer ${APP_NAME}`} />
                  <button
                    type="submit"
                    formAction={skipInvites}
                    className="w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors py-2"
                  >
                    Passer cette étape
                  </button>
                </div>
              </form>

              <button
                onClick={() => setStep(4)}
                className="mt-2 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors"
              >
                Retour
              </button>
            </div>
          )}

          {/* ── STEP JOIN : Rejoindre via code ── */}
          {step === 'join' && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">Rejoindre une entreprise</h2>
                  <p className="text-xs text-white/40">Saisissez le code fourni par votre responsable.</p>
                </div>
              </div>

              {errorMsg && (
                <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-danger/10 border border-danger/25">
                  <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                  <p className="text-xs text-danger/90 leading-snug">{errorMsg}</p>
                </div>
              )}

              <form action={joinViaCode} className="space-y-5">
                {/* Code */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Code entreprise <span className="text-accent">*</span>
                  </label>
                  <input
                    type="text"
                    name="join_code"
                    required
                    maxLength={8}
                    autoComplete="off"
                    placeholder="EX: FTR-28K4"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    className={`${inputCls} font-mono tracking-widest text-center text-lg`}
                  />
                </div>

                {/* Poste */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Votre poste <span className="text-accent">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {JOB_TITLES.map((j) => (
                      <button
                        key={j.value}
                        type="button"
                        onClick={() => setSelectedJobTitle(j.value)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition-all border ${
                          selectedJobTitle === j.value
                            ? 'bg-accent/15 border-accent/40 text-accent'
                            : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.07] hover:text-white/70'
                        }`}
                      >
                        {j.label}
                      </button>
                    ))}
                  </div>

                  {/* Champ libre si "Autre" */}
                  {selectedJobTitle === 'autre' && (
                    <input
                      type="text"
                      placeholder="Ex: Conducteur de travaux"
                      value={customJobTitle}
                      onChange={(e) => setCustomJobTitle(e.target.value)}
                      className={`${inputCls} mt-2`}
                      autoFocus
                    />
                  )}

                  {/* Champ caché transmis au server action */}
                  <input
                    type="hidden"
                    name="job_title"
                    value={
                      selectedJobTitle === 'autre'
                        ? customJobTitle
                        : JOB_TITLES.find((j) => j.value === selectedJobTitle)?.label ?? ''
                    }
                  />
                </div>

                <div className="pt-1">
                  <SubmitButton label="Rejoindre l'entreprise" />
                </div>
              </form>

              <button
                onClick={() => setStep(0)}
                className="mt-4 w-full text-center text-xs text-white/25 hover:text-white/50 transition-colors"
              >
                Retour
              </button>
            </div>
          )}
        </div>
      </div>

      <LegalFooter tone="dark" className="relative z-10 mt-8" />
    </div>
  )
}
