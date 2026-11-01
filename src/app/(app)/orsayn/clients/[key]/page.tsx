import { notFound } from 'next/navigation'
import { getCockpitData } from '../../data'
import ClientDetail from '../../ClientDetail'
import { getSetupIntakeForDetail } from '../../setup-intake-data'
import type { SetupIntakeLoadResult } from '../../setup-intake-domain'

export default async function ClientPage({ params: paramsPromise }: { params: Promise<{ key: string }> }) {
  const params = await paramsPromise
  const data = await getCockpitData()
  if (!data) notFound()

  const key = decodeURIComponent(params.key)
  const row = data.clientRows.find((client) => `${client.sourceInstance}::${client.organizationId ?? '00000000-0000-0000-0000-000000000000'}` === key)
  if (!row) notFound()

  const setupIntakeInitial: SetupIntakeLoadResult | null = row.billingModel === 'setup'
    ? await getSetupIntakeForDetail(row.sourceInstance, row.organizationId)
    : null

  return <ClientDetail row={row} initialSetupIntake={setupIntakeInitial} />
}
