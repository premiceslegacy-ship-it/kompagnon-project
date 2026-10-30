export async function computeMemberIcalToken(memberId: string): Promise<string> {
  // Le token iCal est déterministe et sans expiration : une clé vide rendrait
  // la signature forgeable par quiconque.
  const secret = process.env.MEMBER_SESSION_SECRET
  if (!secret) throw new Error('MEMBER_SESSION_SECRET non configuré.')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`ical-member:${memberId}`))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}
