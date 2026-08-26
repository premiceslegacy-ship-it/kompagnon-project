// Chiffrement applicatif de secrets par tenant (ex. tokens OAuth Super PDP).
// AES-256-GCM via Web Crypto API (crypto.subtle) : nativement disponible sur le
// runtime Cloudflare Workers, contrairement au module `crypto` de Node (voir
// src/lib/operator.ts qui evite deja crypto.timingSafeEqual pour la meme raison).
//
// Format du ciphertext stocke en DB : base64(iv[12] || AES-GCM(plaintext)).
// Le tag d'authentification GCM est deja inclus dans la sortie de crypto.subtle.encrypt.

const IV_LENGTH_BYTES = 12

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(base64Key)
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must decode to exactly 32 bytes (AES-256)')
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return bytesToBase64(combined)
}

export async function decryptSecret(ciphertext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key)
  const combined = base64ToBytes(ciphertext)

  if (combined.length <= IV_LENGTH_BYTES) {
    throw new Error('Ciphertext too short to contain a valid IV')
  }

  const iv = combined.slice(0, IV_LENGTH_BYTES)
  const encrypted = combined.slice(IV_LENGTH_BYTES)

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)

  return new TextDecoder().decode(decrypted)
}
