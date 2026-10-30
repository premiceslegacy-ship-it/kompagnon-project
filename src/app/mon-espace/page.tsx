import { redirect } from 'next/navigation'
import { getMemberSession } from '@/lib/auth/member-session'

export default async function MonEspaceEntryPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const searchParams = await searchParamsPromise
  const rawToken = searchParams.token

  // Token présent → laisser le Route Handler poser le cookie (cookies().set interdit ici)
  if (rawToken) {
    redirect(`/api/auth/member-verify?token=${encodeURIComponent(rawToken)}`)
  }

  // Déjà connecté → dashboard
  const existing = await getMemberSession()
  if (existing) redirect('/mon-espace/dashboard')

  redirect('/mon-espace/request-access')
}
