import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SARAH_VOICE_REMINDER, formatSarahVoiceRules } from '@/lib/ai/sarah-voice'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('voix de Sarah', () => {
  it('tutoie l\'équipe, parle chantier, mais vouvoie les clients', () => {
    const rules = formatSarahVoiceRules()
    expect(rules).toContain('tutoies toujours')
    expect(rules).toContain('chantier')
    expect(rules).toContain('vouvoie ce client')
    expect(rules).toContain('assistante IA')
    expect(formatSarahVoiceRules({ spoken: true })).toContain('À l\'oral')
    expect(SARAH_VOICE_REMINDER).toContain('tutoies')
    expect(rules).toContain('Aucun markdown')
    expect(rules).toContain('Réponds d\'abord à ce qu\'on te demande')
    expect(SARAH_VOICE_REMINDER).toContain('pas d\'astérisques')
    expect(SARAH_VOICE_REMINDER).toContain('DERNIÈRE question')
    expect(SARAH_VOICE_REMINDER).toContain('Au passage')
  })

  it('est appliquée au chat, à la voix et au brief du matin, avec le rappel final dans le chat', () => {
    const chat = read('src/app/api/ai/sarah-secretary/route.ts')
    expect(chat).toContain('${formatSarahVoiceRules()}')
    expect(chat).toContain('${SARAH_VOICE_REMINDER}')
    expect(chat).not.toMatch(/Tu vouvois/)
    expect(chat).toContain('Pour toute autre question, réponds directement')
    expect(read('src/app/api/ai/elevenlabs/signed-url/route.ts')).toContain('formatSarahVoiceRules({ spoken: true })')
    expect(read('src/app/api/cron/sarah-daily-brief/route.ts')).toContain('formatSarahVoiceRules()')
  })

  it('laisse le texte envoyé aux clients vouvoyé (e-mail et relances)', () => {
    expect(read('src/app/api/ai/email-draft/route.ts')).toContain('Vouvoie le destinataire')
    expect(read('src/app/api/cron/sarah-proactive/route.ts')).toContain('Je me permets de vous relancer')
  })

  it('tutoie aussi dans l\'accueil et les indications du widget, sans toucher aux messages système', () => {
    const widget = read('src/components/sarah/SarahWidget.tsx')
    expect(widget).toContain('Je suis Sarah, ton assistante')
    expect(widget).toContain('Tu peux aussi me parler')
    expect(widget).toContain('Pose ta question ou donne une instruction')
    expect(widget).not.toContain('votre assistante')
    expect(widget).not.toContain('Posez votre question')
    // Les erreurs et quotas restent des messages d\'application, vouvoyés.
    expect(widget).toContain('Vous avez atteint la limite de messages IA ce mois-ci.')
  })
})
