import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

const admin = adminClient()
let tenantA: TenantSession
let tenantB: TenantSession
let contractId: string
const chantierIds: string[] = []
const references = {
  client_id: { own: '', foreign: '' },
  chantier_id: { own: '', foreign: '' },
  quote_id: { own: '', foreign: '' },
}

function contractInput() {
  return {
    organization_id: tenantA.orgId,
    title: 'Disposable contract isolation fixture',
    contract_type: 'sous_traitance', role: 'donneur_ordre',
    counterparty_name: 'Local fixture',
    template_key: 'sous_traitance_btp_generique', template_title: 'Local fixture',
  }
}

beforeAll(async () => {
  const target = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Local Supabase only')
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)
  for (const [index, tenant] of [tenantA, tenantB].entries()) {
    const side = index === 0 ? 'own' : 'foreign'
    for (const [column, table] of [['client_id', 'clients'], ['quote_id', 'quotes']] as const) {
      const { data, error } = await admin.from(table).select('id').eq('organization_id', tenant.orgId).limit(1).single()
      if (error || !data) throw new Error(`Missing ${table} fixture`)
      references[column][side] = data.id
    }
    const { data, error } = await admin.from('chantiers').insert({ organization_id: tenant.orgId, title: 'Disposable contract chantier' }).select('id').single()
    if (error || !data) throw new Error(`Chantier fixture failed: ${error?.message}`)
    chantierIds.push(data.id)
    references.chantier_id[side] = data.id
  }
  const { data, error } = await tenantA.client.from('contracts').insert({
    ...contractInput(),
    client_id: references.client_id.own,
    chantier_id: references.chantier_id.own,
    quote_id: references.quote_id.own,
  }).select('id').single()
  if (error || !data) throw new Error(`Legitimate contract failed: ${error?.message}`)
  contractId = data.id
})

afterAll(async () => {
  if (contractId) {
    const { error } = await admin.from('contracts').delete().eq('id', contractId)
    if (error) throw error
  }
  if (chantierIds.length) {
    const { error } = await admin.from('chantiers').delete().in('id', chantierIds)
    if (error) throw error
  }
})

describe('contracts enforce tenant scope independently of form filtering', () => {
  it.each(['client_id', 'chantier_id', 'quote_id'] as const)('rejects foreign %s on insert and update while retaining the legitimate relation', async column => {
    const candidate = contractInput()
    const { data: inserted, error: insertError } = await tenantA.client.from('contracts')
      .insert({ ...candidate, [column]: references[column].foreign }).select('id').maybeSingle()
    // Clean up an unexpected success too, so a failing-before run is isolated.
    if (inserted) {
      const { error: cleanupError } = await admin.from('contracts').delete().eq('id', inserted.id)
      if (cleanupError) throw cleanupError
    }
    expect(insertError, `Foreign ${column} accepted on insert`).not.toBeNull()

    const { error: updateError } = await tenantA.client.from('contracts')
      .update({ [column]: references[column].foreign }).eq('id', contractId)
    if (!updateError) {
      const { error: restoreError } = await admin.from('contracts')
        .update({ [column]: references[column].own }).eq('id', contractId)
      if (restoreError) throw restoreError
    }
    expect(updateError, `Foreign ${column} accepted on update`).not.toBeNull()

    const { data, error } = await tenantA.client.from('contracts').select(column).eq('id', contractId).single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ [column]: references[column].own })
  })
})
