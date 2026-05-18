import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import ContractSignClient from './ContractSignClient'

export const metadata: Metadata = {
  title: 'Signature de contrat',
  robots: 'noindex',
}

export default async function ContractSignPage({ params }: { params: { token: string } }) {
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select(`
      id, title, contract_type, organization_id, counterparty_name,
      status, client_signed_at, pdf_reference, pdf_generated_at, quote_id,
      client:clients(first_name, last_name, contact_name),
      quote:quotes(id, number, title, total_ttc, status)
    `)
    .eq('signature_token', params.token)
    .single()

  if (!contract) notFound()

  const { data: org } = await admin
    .from('organizations')
    .select('name, logo_url, email')
    .eq('id', contract.organization_id)
    .single()

  const alreadySigned = !!contract.client_signed_at
  const archived = contract.status === 'archived'
  const pdfReady = !!contract.pdf_reference

  const clientData = Array.isArray(contract.client) ? contract.client[0] : contract.client
  const clientFullName =
    [clientData?.first_name, clientData?.last_name].filter(Boolean).join(' ').trim() ||
    (clientData as any)?.contact_name ||
    null

  const quoteRaw = Array.isArray(contract.quote) ? contract.quote[0] : contract.quote
  const linkedQuote = quoteRaw && !['accepted', 'converted', 'refused'].includes(quoteRaw.status ?? '')
    ? { id: quoteRaw.id, number: quoteRaw.number, title: quoteRaw.title, total_ttc: quoteRaw.total_ttc }
    : null

  return (
    <ContractSignClient
      token={params.token}
      contractId={contract.id}
      contractTitle={contract.title}
      contractType={contract.contract_type}
      counterpartyName={clientFullName ?? contract.counterparty_name}
      orgName={org?.name ?? ''}
      orgLogoUrl={org?.logo_url ?? null}
      orgEmail={org?.email ?? null}
      pdfReady={pdfReady}
      alreadySigned={alreadySigned}
      signedAt={contract.client_signed_at}
      archived={archived}
      linkedQuote={linkedQuote}
    />
  )
}
