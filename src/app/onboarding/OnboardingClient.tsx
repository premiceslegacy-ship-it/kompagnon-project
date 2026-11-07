'use client'
// @atelier-migrated

import type { OrgRole } from '@/lib/data/queries/roles'
import { CompanyStep, ContactStep, EinvoicingStep, JoinStep, LaunchStep, TeamStep, WelcomeStep } from './OnboardingSteps'
import { useOnboarding } from './useOnboarding'

type Props = { firstName: string | null; initialEmail: string | null; roles: OrgRole[]; joinCode: string | null; selfService: boolean }

export default function OnboardingClient(props: Props) {
  const q = useOnboarding(props)

  switch (q.step) {
    case 0: return <WelcomeStep q={q} />
    case 1: return <CompanyStep q={q} />
    case 2: return <ContactStep q={q} />
    case 'launch': return <LaunchStep q={q} />
    case 3: return <EinvoicingStep q={q} />
    case 4: return <TeamStep q={q} />
    case 'join': return <JoinStep q={q} />
  }
}
