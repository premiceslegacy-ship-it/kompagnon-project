import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import SignClient from './SignClient'

export const metadata: Metadata = {
  title: 'Signature de devis',
  robots: 'noindex',
}

export default async function SignPage({ params }: { params: { token: string } }) {
  const admin = createAdminClient()

  // Charger le devis par token (admin client = pas d'auth requise)
  const { data: quote } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ttc, currency,
      valid_until, organization_id, client_id,
      signed_at
    `)
    .eq('signature_token', params.token)
    .single()

  if (!quote) notFound()

  // Charger org
  const { data: org } = await admin
    .from('organizations')
    .select('name, address_line1, city, postal_code')
    .eq('id', quote.organization_id)
    .single()

  // Charger client
  let clientName: string | null = null
  if (quote.client_id) {
    const { data: client } = await admin
      .from('clients')
      .select('company_name, first_name, last_name')
      .eq('id', quote.client_id)
      .single()
    if (client) {
      clientName = (client as any).company_name
        || [(client as any).first_name, (client as any).last_name].filter(Boolean).join(' ')
        || null
    }
  }

  const orgAddress = org
    ? [org.address_line1, `${org.postal_code ?? ''} ${org.city ?? ''}`.trim()].filter(Boolean).join(', ')
    : null

  const alreadySigned = !!quote.signed_at

  return (
    <SignClient
      token={params.token}
      quoteNumber={quote.number}
      quoteTitle={quote.title}
      totalTtc={quote.total_ttc}
      currency={quote.currency ?? 'EUR'}
      validUntil={quote.valid_until}
      orgName={org?.name ?? ''}
      orgAddress={orgAddress}
      clientName={clientName}
      alreadySigned={alreadySigned}
      signedAt={quote.signed_at}
    />
  )
}
