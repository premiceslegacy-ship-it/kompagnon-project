import { describe, expect, it } from 'vitest'
import { accessPill, activateLabel, detectCurrentTier, isCancelConfirmed, oauthPill, setupAccessText, tierLabel, tierPrice, upgradeTiers } from '@/app/(app)/settings/abonnementModel'
import type { OrganizationModules } from '@/lib/organization-modules'

describe('abonnement : offres', () => {
  it('propose les offres au-dessus de l’offre actuelle', () => {
    expect(upgradeTiers('setup_only').map(t => t.tier)).toEqual(['pro', 'expert'])
    expect(upgradeTiers('pro').map(t => t.tier)).toEqual(['expert'])
    expect(upgradeTiers('expert')).toEqual([])
  })

  it('nomme l’offre et son prix', () => {
    expect(tierLabel('setup_only')).toBe('Sans abonnement IA')
    expect(tierLabel('expert')).toBe('Expert')
    expect(tierPrice('pro')).toBe('69')
    expect(tierPrice('setup_only')).toBeNull()
  })

  it('détecte « Pro » quand Sarah et le vocal en direct sont actifs', () => {
    const on = { sarah_assistant: true, voice_live: true } as OrganizationModules
    expect(detectCurrentTier(on)).toBe('pro')
    expect(detectCurrentTier({ sarah_assistant: true, voice_live: false } as OrganizationModules)).toBe('setup_only')
  })

  it('traduit le statut d’accès en pastille et en phrase', () => {
    expect(accessPill('canceling')).toEqual({ label: 'Résiliation programmée', status: 'wait' })
    expect(accessPill('past_due').status).toBe('danger')
    expect(accessPill('active').label).toBe('Actif')
    expect(setupAccessText('locked')).toContain('suspendu')
    expect(setupAccessText(null)).toContain('à vérifier')
  })

  it('exige le mot « RÉSILIER », sans tenir compte de la casse ni des espaces', () => {
    expect(isCancelConfirmed(' résilier ')).toBe(true)
    expect(isCancelConfirmed('annuler')).toBe(false)
  })
})

describe('e-facturation : statut', () => {
  it('colore le statut de connexion et nomme le bouton selon l’environnement', () => {
    expect(oauthPill('connected')).toBe('success')
    expect(oauthPill('pending')).toBe('wait')
    expect(oauthPill('revoked')).toBe('danger')
    expect(oauthPill('not_connected')).toBe('neutral')
    expect(activateLabel('production')).toBe('Activer la facturation électronique')
    expect(activateLabel('sandbox')).toBe('Tester la connexion Super PDP')
  })
})
