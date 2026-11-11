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
  })

  it('est appliquée au chat, à la voix et au brief du matin, avec le rappel final dans le chat', () => {
    const chat = read('src/app/api/ai/sarah-secretary/route.ts')
    expect(chat).toContain('${formatSarahVoiceRules()}')
    expect(chat).toContain('${SARAH_VOICE_REMINDER}')
    expect(chat).not.toMatch(/Tu vouvois/)
    expect(read('src/app/api/ai/elevenlabs/signed-url/route.ts')).toContain('formatSarahVoiceRules({ spoken: true })')
    expect(read('src/app/api/cron/sarah-daily-brief/route.ts')).toContain('formatSarahVoiceRules()')
  })

  it('laisse le texte envoyé aux clients vouvoyé (e-mail et relances)', () => {
    expect(read('src/app/api/ai/email-draft/route.ts')).toContain('Vouvoie le destinataire')
    expect(read('src/app/api/cron/sarah-proactive/route.ts')).toContain('Je me permets de vous relancer')
  })
})
