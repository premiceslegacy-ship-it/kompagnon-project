import { describe, expect, it } from 'vitest'
import { formatClientOffer, formatOnboardingStatus, getCommercialEventLabel } from '@/app/(app)/orsayn/utils'

describe('libellé de formule dans le cockpit', () => {
  it('affiche le palier temporaire pendant un essai actif, pas le palier de repli', () => {
    expect(formatClientOffer({
      tier: 'setup_only',
      trialTier: 'pro',
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      trialConverted: false,
      accessStatus: 'trialing',
    })).toBe('Essai Pro')
  })

  it('rend explicite un compte qui attend son activation', () => {
    expect(formatClientOffer({
      tier: 'setup_only',
      trialTier: null,
      trialEndsAt: null,
      trialConverted: false,
      accessStatus: 'locked',
    })).toBe('Accès à activer')
  })

  it('rend les deux états d’onboarding et les relances après essai explicites', () => {
    expect(formatOnboardingStatus('pending')).toBe('À terminer')
    expect(formatOnboardingStatus('completed')).toBe('Terminé')
    expect(getCommercialEventLabel('trial_post_expiry_3d')).toBe('Relance après essai J+3')
    expect(getCommercialEventLabel('trial_post_expiry_10d')).toBe('Relance après essai J+10')
  })
})
