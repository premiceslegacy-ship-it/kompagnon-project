import { describe, expect, it } from 'vitest'
import {
  canSignup,
  formatJoinCode,
  isEmail,
  isRedirectSignal,
  otpCells,
  otpComplete,
  otpDigits,
  passwordRuleMet,
  resetStatus,
} from '@/lib/auth-ui'

describe('auth-ui', () => {
  it('reconnaît une adresse email plausible', () => {
    expect(isEmail('jean@dupont-reno.fr')).toBe(true)
    expect(isEmail('  jean@dupont-reno.fr ')).toBe(true)
    expect(isEmail('jean@dupont')).toBe(false)
    expect(isEmail('jean dupont@x.fr')).toBe(false)
    expect(isEmail('')).toBe(false)
  })

  it('exige 8 caractères pour le mot de passe', () => {
    expect(passwordRuleMet('1234567')).toBe(false)
    expect(passwordRuleMet('12345678')).toBe(true)
  })

  it("n'autorise l'inscription que si les trois champs sont valides", () => {
    const ok = { name: 'Jean Dupont', email: 'jean@dupont-reno.fr', password: 'motdepasse' }
    expect(canSignup(ok)).toBe(true)
    expect(canSignup({ ...ok, name: 'J' })).toBe(false)
    expect(canSignup({ ...ok, email: 'jean' })).toBe(false)
    expect(canSignup({ ...ok, password: 'court' })).toBe(false)
  })

  it("signale l'écart seulement quand la confirmation est commencée", () => {
    expect(resetStatus('motdepasse', '')).toEqual({ mismatch: false, canSubmit: false })
    expect(resetStatus('motdepasse', 'mot')).toEqual({ mismatch: true, canSubmit: false })
    expect(resetStatus('motdepasse', 'motdepasse')).toEqual({ mismatch: false, canSubmit: true })
    expect(resetStatus('court', 'court')).toEqual({ mismatch: false, canSubmit: false })
  })

  it('nettoie un code collé', () => {
    expect(otpDigits('12 34-56')).toBe('123456')
    expect(otpDigits('1234567890')).toBe('123456')
    expect(otpDigits('abc')).toBe('')
    expect(otpComplete('123456')).toBe(true)
    expect(otpComplete('12345')).toBe(false)
  })

  it('décrit les six cases du code', () => {
    const cells = otpCells('12')
    expect(cells).toHaveLength(6)
    expect(cells[0]).toEqual({ char: '1', filled: true, current: false })
    expect(cells[2]).toEqual({ char: '', filled: false, current: true })
    expect(cells[3].current).toBe(false)
    expect(otpCells('123456').some((c) => c.current)).toBe(false)
  })

  it('met le code entreprise en majuscules', () => {
    expect(formatJoinCode('ftr-28k4')).toBe('FTR-28K4')
  })

  it('distingue la redirection d\u2019une action serveur d\u2019une vraie panne', () => {
    expect(isRedirectSignal({ digest: 'NEXT_REDIRECT;push;/dashboard;307;' })).toBe(true)
    expect(isRedirectSignal({ digest: 'NEXT_REDIRECT;replace;/orsayn;303;' })).toBe(true)
    expect(isRedirectSignal(new Error('Failed to fetch'))).toBe(false)
    expect(isRedirectSignal({ digest: '123456' })).toBe(false)
    expect(isRedirectSignal(null)).toBe(false)
    expect(isRedirectSignal(undefined)).toBe(false)
  })
})
