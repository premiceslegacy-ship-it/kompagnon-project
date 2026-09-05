import { describe, expect, it } from 'vitest'
import { atelierEmailBrand, escHtml, renderEmailShell } from '@/lib/email/layout'
import { resolveOrganizationFromAddress, resolveOrganizationReplyTo } from '@/lib/email/resolver'
import { ATELIER_PRICING } from '@/lib/pricing'
import { getActivationState } from '@/lib/activation-state'
import { buildAtelierTrialStartedEmail } from '@/lib/email/commercial'

describe('Atelier email branding', () => {
  it('renders the light shell and Samuel signature without an em dash', () => {
    const html = renderEmailShell({
      title: 'Essai',
      headerName: 'Atelier BTP',
      bodyHtml: '<p>Bienvenue</p>',
      brand: atelierEmailBrand({ replyTo: 'contact@orsayn.fr' }),
      includeSignature: true,
    })
    expect(html).toContain('#F7F4EE')
    expect(html).toContain('Samuel<br/>')
    expect(html).toContain('Fondateur d’Atelier BTP')
    expect(html).not.toContain('—')
  })

  it('escapes HTML content', () => {
    expect(escHtml(`<script>alert('x')</script>`)).toBe('&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;')
  })

  it('renders the organization footer attribution', () => {
    const html = renderEmailShell({ title: 'Devis', headerName: 'Bati & Fils', bodyHtml: '<p>Bonjour</p>' })
    expect(html).toContain('Propulsé par Atelier BTP')
  })
})

describe('email sender resolution', () => {
  it('prioritizes custom organization domain then shared slug fallback', () => {
    expect(resolveOrganizationFromAddress({ organizationAddress: 'contact@client.fr', slug: 'client', sharedDomain: 'atelier-btp.fr', deploymentAddress: 'support@atelier-btp.fr' })).toBe('contact@client.fr')
    expect(resolveOrganizationFromAddress({ slug: 'client', sharedDomain: 'atelier-btp.fr', deploymentAddress: 'support@atelier-btp.fr' })).toBe('client@atelier-btp.fr')
    expect(resolveOrganizationFromAddress({ deploymentAddress: 'support@atelier-btp.fr' })).toBe('support@atelier-btp.fr')
  })

  it('uses the organization reply address for tenant messages', () => {
    expect(resolveOrganizationReplyTo({ organizationEmail: 'bonjour@client.fr', atelierReplyTo: 'contact@orsayn.fr' })).toBe('bonjour@client.fr')
    expect(resolveOrganizationReplyTo({ atelierReplyTo: 'contact@orsayn.fr' })).toBe('contact@orsayn.fr')
  })
})

describe('centralized pricing', () => {
  it('keeps LP prices used by activation and Stripe mapping', () => {
    expect(ATELIER_PRICING.setup.amountEur).toBe(3000)
    expect(ATELIER_PRICING.pro.amountEur).toBe(69)
    expect(ATELIER_PRICING.expert.amountEur).toBe(169)
  })
})

describe('activation state', () => {
  it('offers the trial only to an owner with a fresh locked entitlement', () => {
    expect(getActivationState({ role: 'owner', status: 'locked', trialStarted: false }).canStartTrial).toBe(true)
    expect(getActivationState({ role: 'member', status: 'locked', trialStarted: false }).canStartTrial).toBe(false)
    expect(getActivationState({ role: 'owner', status: 'expired', trialStarted: true }).canStartTrial).toBe(false)
  })

  it('presents the self-service trial as Pro', () => {
    const email = buildAtelierTrialStartedEmail({ appUrl: 'https://app.atelier-btp.fr', companyName: 'Atelier Test' })
    expect(email.subject).toContain('14 jours Pro')
    expect(email.html).toContain('formule Pro')
    expect(email.html).not.toContain('formule Expert')
  })

  it('routes unpaid owners to Stripe portal and handles checkout return states', () => {
    expect(getActivationState({ role: 'owner', status: 'unpaid', trialStarted: true }).showPortal).toBe(true)
    expect(getActivationState({ role: 'owner', status: 'unpaid', trialStarted: true }).showPlans).toBe(false)
    expect(getActivationState({ role: 'owner', status: 'expired', trialStarted: true, checkout: 'success' }).checkoutPending).toBe(true)
    expect(getActivationState({ role: 'owner', status: 'expired', trialStarted: true, checkout: 'cancelled' }).checkoutCancelled).toBe(true)
  })
})
