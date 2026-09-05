import type { AccessStatus } from './subscription-access'

export function getActivationState(input: {
  role: string | null | undefined
  status: AccessStatus
  trialStarted: boolean
  checkout?: string | null
}) {
  const owner = input.role === 'owner'
  return {
    owner,
    canStartTrial: owner && input.status === 'locked' && !input.trialStarted,
    showPortal: owner && input.status === 'unpaid',
    showPlans: owner && input.status !== 'unpaid',
    checkoutPending: input.checkout === 'success',
    checkoutCancelled: input.checkout === 'cancelled',
  }
}
