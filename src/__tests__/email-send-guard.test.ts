import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MISSING_ORGANIZATION_EMAIL_ERROR,
  resolveClientFacingReplyTo,
} from '@/lib/email/resolver'

const send = vi.fn()
let orgRow: Record<string, unknown> | null = null

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: orgRow }) }),
      }),
    }),
  }),
}))

const { sendEmail } = await import('@/lib/email')

const baseOrg = {
  name: 'Weber Tôlerie',
  slug: 'weber',
  email: 'weber.paul@gmail.com',
  email_from_name: null,
  email_from_address: null,
}
const mail = { organizationId: 'org-1', to: 'client@exemple.fr', subject: 'Devis', html: '<p>Bonjour</p>' }

beforeEach(() => {
  send.mockReset()
  send.mockResolvedValue({ error: null })
  process.env.RESEND_API_KEY = 're_test'
  process.env.SHARED_EMAIL_DOMAIN = 'atelier-btp.fr'
  process.env.RESEND_REPLY_TO_ADDRESS = 'contact@orsayn.fr'
  orgRow = { ...baseOrg }
})

describe('resolveClientFacingReplyTo', () => {
  it('privilégie l’adresse fixée pour l’envoi, puis l’email de contact de l’entreprise', () => {
    expect(resolveClientFacingReplyTo({ explicitReplyTo: 'a@x.fr', organizationEmail: 'b@x.fr' })).toBe('a@x.fr')
    expect(resolveClientFacingReplyTo({ organizationEmail: ' b@x.fr ' })).toBe('b@x.fr')
  })

  it('ne retombe jamais sur une adresse Atelier : null = envoi bloqué', () => {
    expect(resolveClientFacingReplyTo({ explicitReplyTo: '  ', organizationEmail: null })).toBeNull()
    expect(resolveClientFacingReplyTo({})).toBeNull()
  })
})

describe('sendEmail : réponse du client final', () => {
  it('envoie au nom de l’entreprise et dirige la réponse vers son vrai email (Gmail, Outlook, domaine propre)', async () => {
    for (const email of ['weber.paul@gmail.com', 'paul@outlook.fr', 'contact@weber-tolerie.fr']) {
      orgRow = { ...baseOrg, email }
      const result = await sendEmail(mail)
      expect(result.error).toBeNull()
      const sent = send.mock.calls.at(-1)![0]
      expect(sent.from).toBe('Weber Tôlerie <weber@atelier-btp.fr>')
      expect(sent.replyTo).toBe(email)
    }
  })

  it('bloque l’envoi si l’entreprise n’a pas d’email de contact', async () => {
    for (const email of [null, '', '   ']) {
      orgRow = { ...baseOrg, email }
      const result = await sendEmail(mail)
      expect(result.error).toBe(MISSING_ORGANIZATION_EMAIL_ERROR)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('accepte une adresse de réponse explicite même sans email de contact', async () => {
    orgRow = { ...baseOrg, email: null }
    const result = await sendEmail({ ...mail, replyTo: 'equipe@weber.fr' })
    expect(result.error).toBeNull()
    expect(send.mock.calls[0][0].replyTo).toBe('equipe@weber.fr')
  })

  it('autorise le repli sur Atelier pour un email de compte (code de connexion, invitation)', async () => {
    orgRow = { ...baseOrg, email: null }
    const result = await sendEmail({ ...mail, allowAtelierReplyTo: true })
    expect(result.error).toBeNull()
    expect(send.mock.calls[0][0].replyTo).toBe('contact@orsayn.fr')
  })
})
