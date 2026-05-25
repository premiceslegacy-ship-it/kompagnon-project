export async function computeMemberIcalToken(memberId: string): Promise<string> {
  const secret = process.env.MEMBER_SESSION_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`ical-member:${memberId}`))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}
