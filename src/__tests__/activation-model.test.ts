import { describe, expect, it } from 'vitest'
import {
  activationHeading,
  activationMood,
  exportNotice,
  featuredTier,
  planAction,
  planBadge,
  planCtaLabel,
  planFootnote,
  setupWhatsappUrl,
  PLAN_COPY,
} from '@/app/activation/activationModel'

describe('activationModel', () => {
  it("choisit l'ambiance de l'écran selon l'état de l'abonnement", () => {
    expect(activationMood({ isUnpaid: true, canStartTrial: false, hasConsumedTrial: true })).toBe('unpaid')
    expect(activationMood({ isUnpaid: false, canStartTrial: true, hasConsumedTrial: false })).toBe('trial')
    expect(activationMood({ isUnpaid: false, canStartTrial: false, hasConsumedTrial: true })).toBe('ended')
    expect(activationMood({ isUnpaid: false, canStartTrial: false, hasConsumedTrial: false })).toBe('choose')
  })

  it('donne un titre à chaque ambiance', () => {
    expect(activationHeading('trial').title).toBe('Essayez Pro pendant 7 jours')
    expect(activationHeading('ended').title).toBe('Récupérez vos soirées')
    expect(activationHeading('unpaid').title).toBe('Régularisez votre abonnement')
    expect(activationHeading('choose').title).toBe('Choisissez votre formule')
  })

  it("met Pro en avant pendant l'essai, sinon la formule déjà choisie", () => {
    expect(featuredTier(true, 'expert')).toBe('pro')
    expect(featuredTier(false, 'expert')).toBe('expert')
    expect(planBadge('pro', true, 'expert')).toBe('7 jours offerts')
    expect(planBadge('expert', true, 'expert')).toBeNull()
    expect(planBadge('expert', false, 'expert')).toBe('Recommandé pour reprendre')
  })

  it("lance l'essai seulement depuis Pro et seulement s'il est offert", () => {
    expect(planAction('pro', true)).toBe('trial')
    expect(planAction('expert', true)).toBe('checkout')
    expect(planAction('pro', false)).toBe('checkout')
    expect(planCtaLabel('pro', true)).toBe('Essayer Pro gratuitement')
    expect(planCtaLabel('expert', true)).toBe('Choisir Expert')
    expect(planCtaLabel('pro', false)).toBe('Reprendre avec Pro')
    expect(planFootnote('pro', true)).toContain('aucune carte')
    expect(planFootnote('expert', true)).toContain('Stripe')
  })

  it('reprend les prix du catalogue', () => {
    expect(PLAN_COPY.pro.price).toBe(69)
    expect(PLAN_COPY.expert.price).toBe(169)
  })

  it("annonce l'export demandé", () => {
    expect(exportNotice(undefined)).toBeNull()
    expect(exportNotice('failed')).toContain('pas pu')
    expect(exportNotice('started')).toContain('préparation')
  })

  it('prépare le lien WhatsApp seulement si son adresse est valide', () => {
    expect(setupWhatsappUrl(undefined, 'Dupont')).toBeNull()
    expect(setupWhatsappUrl('pas une url', 'Dupont')).toBeNull()
    const url = setupWhatsappUrl('https://wa.me/33600000000', 'Dupont')
    expect(url).toContain('text=')
    expect(decodeURIComponent(url ?? '')).toContain('Dupont')
  })
})
