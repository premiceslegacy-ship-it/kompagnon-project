import { redirect } from 'next/navigation'
import VerifyOtpForm from './VerifyOtpForm'

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  if (!email) redirect('/login')

  return <VerifyOtpForm email={decodeURIComponent(email)} mode="signup" />
}
