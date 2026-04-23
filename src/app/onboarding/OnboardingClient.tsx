'use client'

import { useState, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import {
  Building2, Users, ArrowRight, Loader2,
  CheckCircle2, AlertCircle, Plus, Trash2, Copy, Check, KeyRound, Upload, ImageIcon,
} from 'lucide-react'
import { completeOnboarding, skipInvites, joinViaCode } from './actions'
import type { OrgRole } from '@/lib/data/queries/roles'
import { createClient } from '@/lib/supabase/client'
import { BUSINESS_ACTIVITIES_BY_PROFILE, resolveBusinessSelection, type BusinessActivityId } from '@/lib/catalog-context'
import { LegalFooter } from '@/components/legal/LegalFooter'
import { APP_NAME } from '@/lib/brand'

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
  invalid_code:      'Code entreprise introuvable. Vérifiez le code et réessayez.',
  join_failed:       "Une erreur est survenue lors de la connexion à l'entreprise. Veuillez réessayer.",
}

type InviteRow = { email: string; roleId: string }

// Étapes owner : 0=welcome, 1=company, 2=team
// Étape joiner : 0=welcome, 'join'=code
type Step = 0 | 1 | 2 | 'join'

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

type Props = { firstName: string | null; roles: OrgRole[]; joinCode: string | null }

export default function OnboardingClient({ firstName, roles, joinCode }: Props) {
  const [step, setStep] = useState<Step>(0)

  // Owner state
  const [companyName, setCompanyName] = useState('')
  const [selectedActivity, setSelectedActivity] = useState<BusinessActivityId | ''>('')
  const [siret, setSiret] = useState('')
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

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#050505] text-white overflow-hidden font-body p-6">
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
        {(step === 'join' ? [0, 1] : [0, 1, 2]).map((_, i) => {
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
        <div className="bg-white/[0.04] backdrop-blur-[40px] border border-white/[0.08] rounded-3xl p-8 lg:p-10">

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
                    onChange={(e) => setCompanyName(e.target.value)}
                    className={inputCls}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    Activité de référence <span className="text-accent">*</span>
                  </label>
                  <div className="space-y-3">
                    {Object.entries(BUSINESS_ACTIVITIES_BY_PROFILE).map(([profileKey, activities]) => (
                      <div key={profileKey} className="space-y-2">
                        <p className="text-[11px] font-semibold tracking-widest uppercase text-white/25">
                          {resolveBusinessSelection({ businessProfile: profileKey }).profileConfig.onboardingLabel}
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {activities.map((activity) => (
                            <button
                              key={activity.id}
                              type="button"
                              onClick={() => setSelectedActivity(activity.id)}
                              className={`px-4 py-3 rounded-xl text-left transition-all border ${
                                selectedActivity === activity.id
                                  ? 'bg-accent/15 border-accent/40 text-accent'
                                  : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:bg-white/[0.07] hover:text-white/70'
                              }`}
                            >
                              <span className="block text-sm font-semibold">{activity.label}</span>
                              <span className="mt-1 block text-xs leading-relaxed opacity-80">{activity.description}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-white/35">
                    Choisissez l’activité qui correspond le mieux à votre entreprise. Vous pourrez ensuite chiffrer plusieurs types de prestations.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-white/35">
                    SIRET
                    <span className="ml-2 normal-case tracking-normal text-white/25 font-normal">(optionnel)</span>
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="123 456 789 00012"
                    value={siret}
                    onChange={(e) => setSiret(e.target.value)}
                    className={inputCls}
                  />
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    disabled={!companyName.trim() || !selectedActivity}
                    onClick={() => setStep(2)}
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

          {/* ── STEP 2 : Invitations (owner) ── */}
          {step === 2 && (
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
                <input type="hidden" name="business_profile" value={resolvedSelection?.businessProfile ?? ''} />
                <input
                  type="hidden"
                  name="sector"
                  value={resolvedSelection?.sectorLabel ?? ''}
                />
                <input type="hidden" name="siret" value={siret} />
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
                onClick={() => setStep(1)}
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
