/**
 * Règles d'affichage partagées par les écrans d'entrée (connexion, inscription,
 * code reçu, mot de passe, invitation). Aucune règle serveur ici : le serveur
 * revalide tout, ces fonctions ne servent qu'à guider la saisie.
 */

export const PASSWORD_MIN_LENGTH = 8
export const OTP_LENGTH = 6

export function isEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim())
}

export function passwordRuleMet(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH
}

export function canSignup(input: { name: string; email: string; password: string }): boolean {
  return input.name.trim().length > 1 && isEmail(input.email) && passwordRuleMet(input.password)
}

export type ResetStatus = { mismatch: boolean; canSubmit: boolean }

/** Le message d'écart n'apparaît qu'une fois la confirmation commencée. */
export function resetStatus(password: string, confirm: string): ResetStatus {
  return {
    mismatch: confirm.length > 0 && password !== confirm,
    canSubmit: passwordRuleMet(password) && password === confirm,
  }
}

/** Ne garde que les chiffres, six au plus (collage d'un code avec espaces compris). */
export function otpDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function otpComplete(code: string): boolean {
  return code.length === OTP_LENGTH
}

export type OtpCell = { char: string; filled: boolean; current: boolean }

export function otpCells(code: string): OtpCell[] {
  return Array.from({ length: OTP_LENGTH }, (_, index) => ({
    char: code[index] ?? '',
    filled: index < code.length,
    current: index === code.length && code.length < OTP_LENGTH,
  }))
}

export function formatJoinCode(raw: string): string {
  return raw.toUpperCase()
}

/** Suggestions de poste proposées en saisie libre (valeurs enregistrées telles quelles). */
export const JOB_TITLE_SUGGESTIONS = [
  'Commercial',
  'Administratif',
  'Chef de chantier',
  'Technicien',
] as const

export const INVITE_SETUP_ERRORS: Record<string, string> = {
  missing_name: 'Veuillez saisir votre nom.',
  missing_password: 'Le mot de passe doit contenir au moins 8 caractères.',
  password_failed: 'Impossible de définir le mot de passe. Veuillez réessayer.',
  update_failed: 'Une erreur est survenue. Veuillez réessayer.',
  invalid_invitation: 'Cette invitation n’est plus valide. Demandez un nouveau lien.',
}

/**
 * Une action serveur qui se termine par `redirect()` fait échouer son appel côté
 * navigateur avec une erreur « NEXT_REDIRECT » : ce n'est pas une panne, la
 * navigation est déjà en cours.
 */
export function isRedirectSignal(error: unknown): boolean {
  const digest = typeof error === 'object' && error !== null ? (error as { digest?: unknown }).digest : undefined
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}
