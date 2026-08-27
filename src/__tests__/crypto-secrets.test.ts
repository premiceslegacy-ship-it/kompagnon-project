import { describe, expect, it } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'

const VALID_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=' // 32 octets en base64

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext value', async () => {
    const ciphertext = await encryptSecret('super-secret-token', VALID_KEY)
    const plaintext = await decryptSecret(ciphertext, VALID_KEY)

    expect(plaintext).toBe('super-secret-token')
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const a = await encryptSecret('same-plaintext', VALID_KEY)
    const b = await encryptSecret('same-plaintext', VALID_KEY)

    expect(a).not.toBe(b)
  })

  it('rejects a key that does not decode to exactly 32 bytes', async () => {
    await expect(encryptSecret('value', 'dG9vLXNob3J0')).rejects.toThrow(/32 bytes/)
  })

  it('rejects a truncated ciphertext', async () => {
    await expect(decryptSecret('YWI=', VALID_KEY)).rejects.toThrow(/too short/)
  })

  it('fails to decrypt with the wrong key', async () => {
    const ciphertext = await encryptSecret('value', VALID_KEY)
    const otherKey = 'OTg3NjU0MzIxMDk4NzY1NDMyMTA5ODc2NTQzMjEwOTg=' // 32 octets, different from VALID_KEY

    await expect(decryptSecret(ciphertext, otherKey)).rejects.toThrow()
  })
})
