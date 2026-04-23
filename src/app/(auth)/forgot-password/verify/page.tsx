import { redirect } from 'next/navigation'
import VerifyRecoveryForm from './VerifyRecoveryForm'

export default async function VerifyRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  if (!email) redirect('/forgot-password')

  return <VerifyRecoveryForm email={decodeURIComponent(email)} />
}
