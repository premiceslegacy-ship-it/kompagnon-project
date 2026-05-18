import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data, error } = await supabase
    .from('invoice_payment_schedule')
    .select('id, label, due_date, amount, amount_type, percentage, position, paid_payment_id')
    .eq('invoice_id', params.id)
    .eq('organization_id', orgId)
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ schedule: data ?? [] })
}
