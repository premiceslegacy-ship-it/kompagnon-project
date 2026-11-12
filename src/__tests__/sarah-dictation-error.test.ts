import { describe, expect, it } from 'vitest'
import { getSarahDictationErrorMessage } from '@/components/sarah/SarahWidget'

describe('Sarah dictation error copy', () => {
  it('keeps technical provider details out of the user message', () => {
    const message = getSarahDictationErrorMessage('openrouter provider mistral failure')
    expect(message).toBe('La transcription vocale n’a pas abouti. Réessayez dans un instant.')
    expect(message).not.toMatch(/openrouter|mistral/i)
  })

  it('maps preserved server codes to clear user-facing messages', () => {
    expect(getSarahDictationErrorMessage('permission_denied')).toContain('Votre rôle')
    expect(getSarahDictationErrorMessage('unauthenticated')).toContain('session a expiré')
  })
})
