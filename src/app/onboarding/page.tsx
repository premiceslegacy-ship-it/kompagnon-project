import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUserProfile } from '@/lib/data/queries/user'
import { getOrgRoles, getOrgJoinCode } from '@/lib/data/queries/roles'
import OnboardingClient from './OnboardingClient'

/**
 * Page d'onboarding — accessible uniquement aux utilisateurs connectés
 * dont le flag `onboarding_done` est false.
 * Le Suspense est requis par Next.js 14 car OnboardingClient utilise useSearchParams().
 */
export default async function OnboardingPage() {
  const profile = await getCurrentUserProfile()

  if (!profile) redirect('/login')
  if (profile.onboarding_done) redirect('/dashboard')

  const firstName = profile.full_name?.split(' ')[0] ?? null
  const [roles, joinCode] = await Promise.all([getOrgRoles(), getOrgJoinCode()])

  return (
    <Suspense>
      <OnboardingClient firstName={firstName} roles={roles} joinCode={joinCode} />
    </Suspense>
  )
}
