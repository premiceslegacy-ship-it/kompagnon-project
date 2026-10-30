import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

let tenantA: TenantSession
let tenantB: TenantSession
let viewerA: TenantSession
let dataA: { clientId: string; quoteId: string; invoiceId: string }
let dataB: { clientId: string; quoteId: string; invoiceId: string }
let lifecycleEditor: TenantSession | null = null
let lifecycleEditorOrgId: string | null = null
let lifecycleEditorUserId: string | null = null


const createdInvoiceIds: string[] = []
const createdQuoteIds: string[] = []
const createdPaymentIds: string[] = []
const createdReminderIds: string[] = []
const createdSectionIds: string[] = []
const createdMaterialIds: string[] = []
const createdLaborRateIds: string[] = []
const createdMetalGridIds: string[] = []
const createdVariantIds: string[] = []
const createdChantierIds: string[] = []


function expectBlocked(result: { data: unknown; error: unknown }) {
  expect(result.error !== null || (Array.isArray(result.data) && result.data.length === 0)).toBe(true)
}
async function createLifecycleEditor(): Promise<TenantSession> {
  const admin = adminClient()
  const email = `isolation-lifecycle-${randomUUID()}@atelier-btp.test`
  const password = `IsolationLifecycle-${randomUUID()}!`
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userError || !userData.user) {
    throw new Error(`Lifecycle fixture user creation failed: ${userError?.message}`)
  }
  lifecycleEditorUserId = userData.user.id

  const { data: membership, error: membershipError } = await admin.from('memberships')
    .select('id, organization_id')
    .eq('user_id', userData.user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (membershipError || !membership) {
    throw new Error(`Lifecycle fixture membership lookup failed: ${membershipError?.message}`)
  }
  const organizationId = membership.organization_id
  lifecycleEditorOrgId = organizationId

  const { data: role, error: roleError } = await admin.from('roles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', 'commercial')
    .single()
  if (roleError || !role) throw new Error(`Lifecycle fixture commercial role missing: ${roleError?.message}`)

  const { data: permissions, error: permissionError } = await admin.from('role_permissions')
    .select('id, permission_key')
    .eq('role_id', role.id)
    .in('permission_key', ['invoices.edit', 'invoices.record_payment'])
  if (permissionError) throw new Error(`Lifecycle fixture permission lookup failed: ${permissionError.message}`)
  const editPermission = permissions?.find((permission) => permission.permission_key === 'invoices.edit')
  const paymentPermission = permissions?.find((permission) => permission.permission_key === 'invoices.record_payment')
  if (!editPermission || !paymentPermission) throw new Error('Lifecycle fixture permissions are incomplete')

  const { error: editError } = await admin.from('role_permissions')
    .update({ is_allowed: true })
    .eq('id', editPermission.id)
  if (editError) throw new Error(`Lifecycle fixture edit permission failed: ${editError.message}`)
  const { error: paymentError } = await admin.from('role_permissions')
    .update({ is_allowed: false })
    .eq('id', paymentPermission.id)
  if (paymentError) throw new Error(`Lifecycle fixture payment permission failed: ${paymentError.message}`)

  const { error: roleChangeError } = await admin.from('memberships')
    .update({ role_id: role.id })
    .eq('id', membership.id)
  if (roleChangeError) throw new Error(`Lifecycle fixture role assignment failed: ${roleChangeError.message}`)

  const session = await signInAsTenant(email, password)
  if (session.orgId !== lifecycleEditorOrgId) {
    throw new Error('Lifecycle fixture signed in to an unexpected organization')
  }
  return session
}


beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)
  viewerA = await signInAsTenant(TENANTS.viewer.email, TENANTS.viewer.password)

  const admin = adminClient()
  const [clientA, quoteA, invoiceA, clientB, quoteB, invoiceB] = await Promise.all([
    admin.from('clients').select('id').eq('organization_id', tenantA.orgId).eq('company_name', 'Client de A').single(),
    admin.from('quotes').select('id').eq('organization_id', tenantA.orgId).eq('number', 'DEV-TEST-A').single(),
    admin.from('invoices').select('id').eq('organization_id', tenantA.orgId).eq('number', 'FAC-TEST-A').single(),
    admin.from('clients').select('id').eq('organization_id', tenantB.orgId).eq('company_name', 'Client de B').single(),
    admin.from('quotes').select('id').eq('organization_id', tenantB.orgId).eq('number', 'DEV-TEST-B').single(),
    admin.from('invoices').select('id').eq('organization_id', tenantB.orgId).eq('number', 'FAC-TEST-B').single(),
  ])
  const fixtureResults = [clientA, quoteA, invoiceA, clientB, quoteB, invoiceB]
  for (const result of fixtureResults) {
    if (result.error || !result.data) throw new Error(`Isolation fixtures missing: ${result.error?.message}`)
  }
  if (!clientA.data || !quoteA.data || !invoiceA.data || !clientB.data || !quoteB.data || !invoiceB.data) {
    throw new Error('Isolation fixtures were incomplete after lookup')
  }
  dataA = { clientId: clientA.data.id, quoteId: quoteA.data.id, invoiceId: invoiceA.data.id }
  dataB = { clientId: clientB.data.id, quoteId: quoteB.data.id, invoiceId: invoiceB.data.id }
  lifecycleEditor = await createLifecycleEditor()
})

afterAll(async () => {
  const admin = adminClient()
  const lifecycleOrgIds = new Set<string>()
  if (lifecycleEditorOrgId) {
    lifecycleOrgIds.add(lifecycleEditorOrgId)
  } else if (lifecycleEditorUserId) {
    const { data: memberships, error: membershipError } = await admin.from('memberships')
      .select('organization_id')
      .eq('user_id', lifecycleEditorUserId)
    if (membershipError) throw new Error(`Lifecycle fixture cleanup lookup failed: ${membershipError.message}`)
    for (const membership of memberships ?? []) lifecycleOrgIds.add(membership.organization_id)
  }
  for (const organizationId of lifecycleOrgIds) {
    const { error } = await admin.from('organizations').delete().eq('id', organizationId)
    if (error) throw new Error(`Lifecycle fixture organization cleanup failed: ${error.message}`)
  }
  if (lifecycleEditorUserId) {
    const { error } = await admin.auth.admin.deleteUser(lifecycleEditorUserId)
    if (error) throw new Error(`Lifecycle fixture user cleanup failed: ${error.message}`)
  }

  if (createdReminderIds.length) {
    const { error } = await admin.from('reminders').delete().in('id', createdReminderIds)
    if (error) throw new Error(`Test reminder cleanup failed: ${error.message}`)
  }
  if (createdPaymentIds.length) {
    const { error } = await admin.from('payments').delete().in('id', createdPaymentIds)
    if (error) throw new Error(`Test payment cleanup failed: ${error.message}`)
  }
  if (createdInvoiceIds.length) {
    const { error } = await admin.from('invoices').delete().in('id', createdInvoiceIds)
    if (error) throw new Error(`Test invoice cleanup failed: ${error.message}`)
  }
  if (createdChantierIds.length) {
    const { error } = await admin.from('chantiers').delete().in('id', createdChantierIds)
    if (error) throw new Error(`Test chantier cleanup failed: ${error.message}`)
  }
  if (createdQuoteIds.length) {
    const { error } = await admin.from('quotes').delete().in('id', createdQuoteIds)
    if (error) throw new Error(`Test quote cleanup failed: ${error.message}`)
  }
  if (createdSectionIds.length) {
    const { error } = await admin.from('quote_sections').delete().in('id', createdSectionIds)
    if (error) throw new Error(`Test section cleanup failed: ${error.message}`)
  }
  if (createdVariantIds.length) {
    const { error } = await admin.from('material_price_variants').delete().in('id', createdVariantIds)
    if (error) throw new Error(`Test variant cleanup failed: ${error.message}`)
  }
  if (createdMetalGridIds.length) {
    const { error } = await admin.from('metal_price_grids').delete().in('id', createdMetalGridIds)
    if (error) throw new Error(`Test metal grid cleanup failed: ${error.message}`)
  }
  if (createdLaborRateIds.length) {
    const { error } = await admin.from('labor_rates').delete().in('id', createdLaborRateIds)
    if (error) throw new Error(`Test labor rate cleanup failed: ${error.message}`)
  }
  if (createdMaterialIds.length) {
    const { error } = await admin.from('materials').delete().in('id', createdMaterialIds)
    if (error) throw new Error(`Test material cleanup failed: ${error.message}`)
  }
})

describe('migration 196 — cross-organization billing references', () => {
  it('rejects foreign tenant targets on invoices, quotes, payments, and reminders', async () => {
    const nonce = randomUUID()

    const foreignQuoteClient = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataB.clientId,
      number: `DEV-196-${nonce}-client`,
      title: 'Cross-tenant client reference',
    }).select('id').maybeSingle()
    if (foreignQuoteClient.data?.id) createdQuoteIds.push(foreignQuoteClient.data.id)
    expectBlocked(foreignQuoteClient)

    const foreignQuoteInvoice = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      invoice_id: dataB.invoiceId,
      number: `DEV-196-${nonce}-invoice`,
      title: 'Cross-tenant invoice reference',
    }).select('id').maybeSingle()
    if (foreignQuoteInvoice.data?.id) createdQuoteIds.push(foreignQuoteInvoice.data.id)
    expectBlocked(foreignQuoteInvoice)

    const foreignQuoteParent = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      parent_quote_id: dataB.quoteId,
      number: `DEV-196-${nonce}-parent`,
      title: 'Cross-tenant parent quote reference',
    }).select('id').maybeSingle()
    if (foreignQuoteParent.data?.id) createdQuoteIds.push(foreignQuoteParent.data.id)
    expectBlocked(foreignQuoteParent)

    const foreignInvoiceClient = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataB.clientId,
      number: `FAC-196-${nonce}-client`,
      title: 'Cross-tenant client reference',
    }).select('id').maybeSingle()
    if (foreignInvoiceClient.data?.id) createdInvoiceIds.push(foreignInvoiceClient.data.id)
    expectBlocked(foreignInvoiceClient)

    const foreignInvoiceQuote = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      quote_id: dataB.quoteId,
      number: `FAC-196-${nonce}-quote`,
      title: 'Cross-tenant quote reference',
    }).select('id').maybeSingle()
    if (foreignInvoiceQuote.data?.id) createdInvoiceIds.push(foreignInvoiceQuote.data.id)
    expectBlocked(foreignInvoiceQuote)
    const { data: invoiceForUpdate, error: invoiceForUpdateError } = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `FAC-196-${nonce}-update`,
      title: 'Cross-tenant update reference',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(invoiceForUpdateError).toBeNull()
    expect(invoiceForUpdate).not.toBeNull()
    if (!invoiceForUpdate) return
    createdInvoiceIds.push(invoiceForUpdate.id)

    const foreignClientUpdate = await tenantA.client.from('invoices')
      .update({ client_id: dataB.clientId })
      .eq('id', invoiceForUpdate.id)
      .select('id')
    expectBlocked(foreignClientUpdate)

    const { data: unchangedInvoice, error: unchangedInvoiceError } = await adminClient().from('invoices')
      .select('client_id')
      .eq('id', invoiceForUpdate.id)
      .single()
    expect(unchangedInvoiceError).toBeNull()
    expect(unchangedInvoice?.client_id).toBe(dataA.clientId)


    const foreignPayment = await tenantA.client.from('payments').insert({
      organization_id: tenantA.orgId,
      invoice_id: dataB.invoiceId,
      client_id: dataA.clientId,
      amount: 25,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'manual',
    }).select('id').maybeSingle()
    if (foreignPayment.data?.id) createdPaymentIds.push(foreignPayment.data.id)
    expectBlocked(foreignPayment)

    const foreignPaymentClient = await tenantA.client.from('payments').insert({
      organization_id: tenantA.orgId,
      invoice_id: dataA.invoiceId,
      client_id: dataB.clientId,
      amount: 25,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'manual',
    }).select('id').maybeSingle()
    if (foreignPaymentClient.data?.id) createdPaymentIds.push(foreignPaymentClient.data.id)
    expectBlocked(foreignPaymentClient)

    const foreignReminder = await tenantA.client.from('reminders').insert({
      organization_id: tenantA.orgId,
      invoice_id: dataB.invoiceId,
      client_id: dataA.clientId,
      type: 'payment_reminder',
    }).select('id').maybeSingle()
    if (foreignReminder.data?.id) createdReminderIds.push(foreignReminder.data.id)
    expectBlocked(foreignReminder)

    const foreignQuoteReminder = await tenantA.client.from('reminders').insert({
      organization_id: tenantA.orgId,
      quote_id: dataB.quoteId,
      client_id: dataA.clientId,
      type: 'quote_followup',
    }).select('id').maybeSingle()
    if (foreignQuoteReminder.data?.id) createdReminderIds.push(foreignQuoteReminder.data.id)
    expectBlocked(foreignQuoteReminder)

    const foreignClientReminder = await tenantA.client.from('reminders').insert({
      organization_id: tenantA.orgId,
      invoice_id: dataA.invoiceId,
      client_id: dataB.clientId,
      type: 'payment_reminder',
    }).select('id').maybeSingle()
    if (foreignClientReminder.data?.id) createdReminderIds.push(foreignClientReminder.data.id)
    expectBlocked(foreignClientReminder)
  })

  it('allows same-organization quote, invoice, and payment relationships', async () => {
    const nonce = randomUUID()
    const { data: quote, error: quoteError } = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `DEV-196-${nonce}`,
      title: 'Legitimate same-tenant quote',
      status: 'draft',
    }).select('id').single()
    expect(quoteError).toBeNull()
    expect(quote).not.toBeNull()
    if (!quote) return
    createdQuoteIds.push(quote.id)

    const { data: invoice, error: invoiceError } = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      quote_id: quote.id,
      number: `FAC-196-${nonce}`,
      title: 'Legitimate same-tenant invoice',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(invoiceError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)
    const sameOrgQuoteUpdate = await tenantA.client.from('invoices')
      .update({ quote_id: dataA.quoteId })
      .eq('id', invoice.id)
    expect(sameOrgQuoteUpdate.error).toBeNull()

    const { data: payment, error: paymentError } = await tenantA.client.from('payments').insert({
      organization_id: tenantA.orgId,
      invoice_id: invoice.id,
      client_id: dataA.clientId,
      amount: 25,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'manual',
    }).select('id').single()
    expect(paymentError).toBeNull()
    if (payment) createdPaymentIds.push(payment.id)
  })

  it('accepts same-organization chantier links and rejects cross-organization invoice links', async () => {
    const admin = adminClient()
    const nonce = randomUUID()
    const [{ data: chantierA, error: chantierAError }, { data: chantierB, error: chantierBError }] = await Promise.all([
      admin.from('chantiers').insert({ organization_id: tenantA.orgId, title: `Tenant A chantier ${nonce}` }).select('id').single(),
      admin.from('chantiers').insert({ organization_id: tenantB.orgId, title: `Tenant B chantier ${nonce}` }).select('id').single(),
    ])
    expect(chantierAError).toBeNull()
    expect(chantierBError).toBeNull()
    expect(chantierA).not.toBeNull()
    expect(chantierB).not.toBeNull()
    if (!chantierA || !chantierB) return
    createdChantierIds.push(chantierA.id, chantierB.id)

    const { data: invoice, error: invoiceError } = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      chantier_id: chantierA.id,
      number: `FAC-196-CHANTIER-${nonce}`,
      title: 'Same-organization chantier invoice',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(invoiceError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)

    const foreignInsert = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      chantier_id: chantierB.id,
      number: `FAC-196-CHANTIER-FOREIGN-${nonce}`,
      title: 'Foreign chantier invoice',
      status: 'draft',
      currency: 'EUR',
    }).select('id').maybeSingle()
    expectBlocked(foreignInsert)

    const foreignUpdate = await tenantA.client.from('invoices')
      .update({ chantier_id: chantierB.id })
      .eq('id', invoice.id)
      .select('id')
    expectBlocked(foreignUpdate)

    const { data: unchanged, error: readError } = await admin.from('invoices')
      .select('chantier_id')
      .eq('id', invoice.id)
      .single()
    expect(readError).toBeNull()
    expect(unchanged?.chantier_id).toBe(chantierA.id)
  })

  it('validates quote sections and catalog references on document line items', async () => {
    const admin = adminClient()
    const nonce = randomUUID()

    const { data: quote, error: quoteError } = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `DEV-196-ITEM-${nonce}`,
      title: 'Line item FK checks',
      status: 'draft',
    }).select('id').single()
    expect(quoteError).toBeNull()
    expect(quote).not.toBeNull()
    if (!quote) return
    createdQuoteIds.push(quote.id)

    const { data: sectionA, error: sectionAError } = await tenantA.client.from('quote_sections').insert({
      quote_id: quote.id,
      title: 'Tenant A section',
      position: 1,
    }).select('id').single()
    expect(sectionAError).toBeNull()
    expect(sectionA).not.toBeNull()
    if (!sectionA) return
    createdSectionIds.push(sectionA.id)

    const { data: sectionB, error: sectionBError } = await admin.from('quote_sections').insert({
      quote_id: dataB.quoteId,
      title: 'Tenant B section',
      position: 1,
    }).select('id').single()
    expect(sectionBError).toBeNull()
    expect(sectionB).not.toBeNull()
    if (!sectionB) return
    createdSectionIds.push(sectionB.id)

    const [{ data: materialA, error: materialAError }, { data: materialB, error: materialBError }] = await Promise.all([
      admin.from('materials').insert({ organization_id: tenantA.orgId, name: `Tenant A material ${nonce}` }).select('id').single(),
      admin.from('materials').insert({ organization_id: tenantB.orgId, name: `Tenant B material ${nonce}` }).select('id').single(),
    ])
    expect(materialAError).toBeNull()
    expect(materialBError).toBeNull()
    expect(materialA).not.toBeNull()
    expect(materialB).not.toBeNull()
    if (!materialA || !materialB) return
    createdMaterialIds.push(materialA.id, materialB.id)
    const { data: laborA, error: laborAError } = await admin.from('labor_rates')
      .insert({ organization_id: tenantA.orgId, designation: `Tenant A labor ${nonce}` })
      .select('id')
      .single()
    if (laborA) createdLaborRateIds.push(laborA.id)
    expect(laborAError).toBeNull()
    expect(laborA).not.toBeNull()
    if (!laborA) return

    const { data: laborB, error: laborBError } = await admin.from('labor_rates')
      .insert({ organization_id: tenantB.orgId, designation: `Tenant B labor ${nonce}` })
      .select('id')
      .single()
    if (laborB) createdLaborRateIds.push(laborB.id)
    expect(laborBError).toBeNull()
    expect(laborB).not.toBeNull()
    if (!laborB) return

    const { data: metalGridA, error: metalGridAError } = await admin.from('metal_price_grids')
      .insert({ organization_id: tenantA.orgId, label: `Tenant A grid ${nonce}`, metal_code: 'ALU' })
      .select('id')
      .single()
    if (metalGridA) createdMetalGridIds.push(metalGridA.id)
    expect(metalGridAError).toBeNull()
    expect(metalGridA).not.toBeNull()
    if (!metalGridA) return

    const { data: metalGridB, error: metalGridBError } = await admin.from('metal_price_grids')
      .insert({ organization_id: tenantB.orgId, label: `Tenant B grid ${nonce}`, metal_code: 'ALU' })
      .select('id')
      .single()
    if (metalGridB) createdMetalGridIds.push(metalGridB.id)
    expect(metalGridBError).toBeNull()
    expect(metalGridB).not.toBeNull()
    if (!metalGridB) return

    const { data: variantA, error: variantAError } = await admin.from('material_price_variants')
      .insert({ organization_id: tenantA.orgId, material_id: materialA.id, label: `Tenant A variant ${nonce}` })
      .select('id')
      .single()
    if (variantA) createdVariantIds.push(variantA.id)
    expect(variantAError).toBeNull()
    expect(variantA).not.toBeNull()
    if (!variantA) return

    const { data: variantB, error: variantBError } = await admin.from('material_price_variants')
      .insert({ organization_id: tenantB.orgId, material_id: materialB.id, label: `Tenant B variant ${nonce}` })
      .select('id')
      .single()
    if (variantB) createdVariantIds.push(variantB.id)
    expect(variantBError).toBeNull()
    expect(variantB).not.toBeNull()
    if (!variantB) return


    const { data: quoteItem, error: quoteItemError } = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      section_id: sectionA.id,
      material_id: materialA.id,
      labor_rate_id: laborA.id,
      metal_grid_id: metalGridA.id,
      catalog_variant_id: variantA.id,
      description: 'Same-tenant catalog item',
      quantity: 1,
      unit_price: 100,
    }).select('id').single()
    expect(quoteItemError).toBeNull()
    expect(quoteItem).not.toBeNull()
    if (!quoteItem) return

    const sameOrgQuoteItemUpdate = await tenantA.client.from('quote_items')
      .update({ description: 'Legitimate same-tenant item edit' })
      .eq('id', quoteItem.id)
    expect(sameOrgQuoteItemUpdate.error).toBeNull()

    const foreignMaterialUpdate = await tenantA.client.from('quote_items')
      .update({ material_id: materialB.id })
      .eq('id', quoteItem.id)
      .select('id')
    expectBlocked(foreignMaterialUpdate)
    const { data: unchangedQuoteItem, error: unchangedQuoteItemError } = await admin.from('quote_items')
      .select('material_id, description')
      .eq('id', quoteItem.id)
      .single()
    expect(unchangedQuoteItemError).toBeNull()
    expect(unchangedQuoteItem).toMatchObject({
      material_id: materialA.id,
      description: 'Legitimate same-tenant item edit',
    })

    const foreignSectionItem = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      section_id: sectionB.id,
      description: 'Foreign section',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignSectionItem)

    const foreignMaterialItem = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      material_id: materialB.id,
      description: 'Foreign material',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignMaterialItem)
    const foreignLaborItem = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      labor_rate_id: laborB.id,
      description: 'Foreign labor rate',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignLaborItem)

    const foreignMetalGridItem = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      metal_grid_id: metalGridB.id,
      description: 'Foreign metal grid',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignMetalGridItem)

    const foreignVariantItem = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      catalog_variant_id: variantB.id,
      description: 'Foreign material variant',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignVariantItem)


    const { data: invoice, error: invoiceError } = await tenantA.client.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `FAC-196-ITEM-${nonce}`,
      title: 'Invoice item FK checks',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(invoiceError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)

    const { data: invoiceItem, error: invoiceItemError } = await tenantA.client.from('invoice_items').insert({
      invoice_id: invoice.id,
      material_id: materialA.id,
      catalog_variant_id: variantA.id,
      description: 'Same-tenant invoice item',
      quantity: 1,
      unit_price: 100,
    }).select('id').single()
    expect(invoiceItemError).toBeNull()
    expect(invoiceItem).not.toBeNull()
    if (!invoiceItem) return

    const sameOrgInvoiceItemUpdate = await tenantA.client.from('invoice_items')
      .update({ description: 'Legitimate same-tenant invoice item edit' })
      .eq('id', invoiceItem.id)
    expect(sameOrgInvoiceItemUpdate.error).toBeNull()

    const foreignInvoiceMaterialUpdate = await tenantA.client.from('invoice_items')
      .update({ material_id: materialB.id })
      .eq('id', invoiceItem.id)
      .select('id')
    expectBlocked(foreignInvoiceMaterialUpdate)
    const { data: unchangedInvoiceItem, error: unchangedInvoiceItemError } = await admin.from('invoice_items')
      .select('material_id, description')
      .eq('id', invoiceItem.id)
      .single()
    expect(unchangedInvoiceItemError).toBeNull()
    expect(unchangedInvoiceItem).toMatchObject({
      material_id: materialA.id,
      description: 'Legitimate same-tenant invoice item edit',
    })
    const foreignInvoiceItem = await tenantA.client.from('invoice_items').insert({
      invoice_id: invoice.id,
      material_id: materialB.id,
      description: 'Foreign invoice material',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignInvoiceItem)
    const foreignInvoiceVariant = await tenantA.client.from('invoice_items').insert({
      invoice_id: invoice.id,
      catalog_variant_id: variantB.id,
      description: 'Foreign invoice variant',
      quantity: 1,
      unit_price: 100,
    }).select('id').maybeSingle()
    expectBlocked(foreignInvoiceVariant)
  })

  it('rejects changing invoice organization even when its existing references stay unchanged', async () => {
    const admin = adminClient()
    const nonce = randomUUID()
    const { data: invoice, error: insertError } = await admin.from('invoices').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `FAC-196-MOVE-${nonce}`,
      title: 'Organization movement guard',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(insertError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)

    const organizationChange = await admin.from('invoices')
      .update({ organization_id: tenantB.orgId })
      .eq('id', invoice.id)
      .select('id')
    expectBlocked(organizationChange)

    const { data: unchanged, error: readError } = await admin.from('invoices')
      .select('organization_id')
      .eq('id', invoice.id)
      .single()
    expect(readError).toBeNull()
    expect(unchanged?.organization_id).toBe(tenantA.orgId)
  })
})

describe('migration 196 — lifecycle and privilege boundaries', () => {
  it('blocks forged draft payments without breaking legitimate edits', async () => {
    const editor = lifecycleEditor
    if (!editor) throw new Error('Lifecycle editor fixture missing')
    const admin = adminClient()
    const { data: organization, error: organizationError } = await admin.from('organizations')
      .select('is_vat_subject')
      .eq('id', editor.orgId)
      .single()
    expect(organizationError).toBeNull()
    expect(organization).not.toBeNull()
    if (!organization) return
    const vatRate = organization.is_vat_subject ? 20 : 0
    const totalHt = 1000
    const totalTva = totalHt * vatRate / 100
    const totalTtc = totalHt + totalTva
    const { data: invoice, error: insertError } = await admin.from('invoices').insert({
      organization_id: editor.orgId,
      number: `FAC-196-LIFECYCLE-${randomUUID()}`,
      title: 'Draft payment regression',
      status: 'draft',
      total_ht: totalHt,
      total_tva: totalTva,
      total_ttc: totalTtc,
      currency: 'EUR',
    }).select('id').single()
    expect(insertError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)

    const { error: invoiceItemError } = await admin.from('invoice_items').insert({
      invoice_id: invoice.id,
      description: 'Valid lifecycle fixture line',
      quantity: 1,
      unit_price: totalHt,
      vat_rate: vatRate,
    })
    expect(invoiceItemError).toBeNull()

    const forgedPayment = await editor.client.from('invoices')
      .update({ status: 'paid', total_paid: totalTtc, paid_at: new Date().toISOString() })
      .eq('id', invoice.id)
      .select('id')
    expectBlocked(forgedPayment)
    expect(forgedPayment.error?.code).toBe('P0001')
    const { data: afterPayment, error: afterPaymentError } = await admin.from('invoices')
      .select('status, total_paid, paid_at, total_ht, total_tva, total_ttc, issuance_snapshot')
      .eq('id', invoice.id)
      .single()
    expect(afterPaymentError).toBeNull()
    expect(afterPayment).toMatchObject({
      status: 'draft',
      total_paid: 0,
      paid_at: null,
      total_ht: totalHt,
      total_tva: totalTva,
      total_ttc: totalTtc,
      issuance_snapshot: null,
    })

    const { error: legitimateEditError } = await editor.client.from('invoices')
      .update({ title: 'Editable draft' })
      .eq('id', invoice.id)
    expect(legitimateEditError).toBeNull()
    const { data: editedInvoice, error: editedInvoiceError } = await admin.from('invoices')
      .select('title')
      .eq('id', invoice.id)
      .single()
    expect(editedInvoiceError).toBeNull()
    expect(editedInvoice?.title).toBe('Editable draft')
  })

  it('reserves the sending claim and rollback for the service role', async () => {
    const editor = lifecycleEditor
    if (!editor) throw new Error('Lifecycle editor fixture missing')
    const admin = adminClient()
    const { data: invoice, error: insertError } = await admin.from('invoices').insert({
      organization_id: editor.orgId,
      number: `FAC-196-SENDING-${randomUUID()}`,
      title: 'Sending claim regression',
      status: 'draft',
      currency: 'EUR',
    }).select('id').single()
    expect(insertError).toBeNull()
    expect(invoice).not.toBeNull()
    if (!invoice) return
    createdInvoiceIds.push(invoice.id)


    const forgedClaim = await editor.client.from('invoices')
      .update({ status: 'sending' })
      .eq('id', invoice.id)
      .select('id')
    expectBlocked(forgedClaim)
    expect(forgedClaim.error?.code).toBe('P0001')
    const { data: afterClaim, error: afterClaimError } = await admin.from('invoices')
      .select('status')
      .eq('id', invoice.id)
      .single()
    expect(afterClaimError).toBeNull()
    expect(afterClaim?.status).toBe('draft')

    const { error: serverClaimError } = await admin.from('invoices')
      .update({ status: 'sending' })
      .eq('id', invoice.id)
    expect(serverClaimError).toBeNull()
    const { error: serverRollbackError } = await admin.from('invoices')
      .update({ status: 'draft' })
      .eq('id', invoice.id)
    expect(serverRollbackError).toBeNull()
    const { data: afterRollback, error: afterRollbackError } = await admin.from('invoices')
      .select('status, issuance_snapshot')
      .eq('id', invoice.id)
      .single()
    expect(afterRollbackError).toBeNull()
    expect(afterRollback).toMatchObject({ status: 'draft', issuance_snapshot: null })
  })

  it('keeps accepted quote children and signature capability metadata immutable, blocks status downgrade, and allows conversion', async () => {
    const admin = adminClient()
    const nonce = randomUUID()
    const { data: quote, error: quoteInsertError } = await tenantA.client.from('quotes').insert({
      organization_id: tenantA.orgId,
      client_id: dataA.clientId,
      number: `DEV-196-LOCK-${nonce}`,
      title: 'Accepted quote lifecycle regression',
      status: 'draft',
    }).select('id').single()
    expect(quoteInsertError).toBeNull()
    expect(quote).not.toBeNull()
    if (!quote) return
    createdQuoteIds.push(quote.id)

    const { data: section, error: sectionInsertError } = await tenantA.client.from('quote_sections').insert({
      quote_id: quote.id,
      title: 'Draft section',
      position: 1,
    }).select('id').single()
    expect(sectionInsertError).toBeNull()
    expect(section).not.toBeNull()
    if (!section) return
    const { data: item, error: itemInsertError } = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      section_id: section.id,
      description: 'Draft line',
      quantity: 1,
      unit_price: 100,
    }).select('id').single()
    expect(itemInsertError).toBeNull()
    expect(item).not.toBeNull()
    if (!item) return

    const { error: draftEditError } = await tenantA.client.from('quote_sections')
      .update({ title: 'Legitimately edited while draft' })
      .eq('id', section.id)
    expect(draftEditError).toBeNull()

    const { error: acceptError } = await tenantA.client.from('quotes')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', quote.id)
    expect(acceptError).toBeNull()
    const { data: acceptedQuote, error: acceptedQuoteError } = await admin.from('quotes')
      .select('status, accepted_at, document_snapshot')
      .eq('id', quote.id)
      .single()
    expect(acceptedQuoteError).toBeNull()
    expect(acceptedQuote?.status).toBe('accepted')
    expect(acceptedQuote?.accepted_at).not.toBeNull()
    expect(acceptedQuote?.document_snapshot).not.toBeNull()
    const clientTokenChange = await tenantA.client.from('quotes')
      .update({ signature_token: randomUUID() })
      .eq('id', quote.id)
      .select('id')
    expectBlocked(clientTokenChange)

    const clientExpiryChange = await tenantA.client.from('quotes')
      .update({ signature_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', quote.id)
      .select('id')
    expectBlocked(clientExpiryChange)



    const downgrade = await tenantA.client.from('quotes')
      .update({ status: 'sent' })
      .eq('id', quote.id)
      .select('id')
    expectBlocked(downgrade)

    const childUpdate = await tenantA.client.from('quote_sections')
      .update({ title: 'Changed after acceptance' })
      .eq('id', section.id)
      .select('id')
    expectBlocked(childUpdate)
    const itemUpdate = await tenantA.client.from('quote_items')
      .update({ description: 'Changed after acceptance' })
      .eq('id', item.id)
      .select('id')
    expectBlocked(itemUpdate)

    const itemInsert = await tenantA.client.from('quote_items').insert({
      quote_id: quote.id,
      section_id: section.id,
      description: 'Added after acceptance',
      quantity: 1,
      unit_price: 100,
    }).select('id')
    expectBlocked(itemInsert)

    const itemDelete = await tenantA.client.from('quote_items')
      .delete()
      .eq('id', item.id)
      .select('id')
    expectBlocked(itemDelete)

    const childInsert = await tenantA.client.from('quote_sections').insert({
      quote_id: quote.id,
      title: 'Added after acceptance',
      position: 2,
    })
    expectBlocked(childInsert)

    const childDelete = await tenantA.client.from('quote_sections')
      .delete()
      .eq('id', section.id)
      .select('id')
    expectBlocked(childDelete)
    const serverItemEdit = await admin.from('quote_items')
      .update({ description: 'Service role cannot rewrite accepted terms' })
      .eq('id', item.id)
    expectBlocked(serverItemEdit)

    const serverEdit = await admin.from('quote_sections')
      .update({ title: 'Service role cannot rewrite accepted terms' })
      .eq('id', section.id)
    expectBlocked(serverEdit)
    const { data: unchangedQuote, error: unchangedQuoteError } = await admin.from('quotes')
      .select('status, signature_token, signature_token_expires_at')
      .eq('id', quote.id)
      .single()
    expect(unchangedQuoteError).toBeNull()
    expect(unchangedQuote).toMatchObject({
      status: 'accepted',
      signature_token: null,
      signature_token_expires_at: null,
    })
    const { data: unchangedSections, error: unchangedSectionsError } = await admin.from('quote_sections')
      .select('id, title')
      .eq('quote_id', quote.id)
    expect(unchangedSectionsError).toBeNull()
    expect(unchangedSections).toEqual([{ id: section.id, title: 'Legitimately edited while draft' }])
    const { data: unchangedItems, error: unchangedItemsError } = await admin.from('quote_items')
      .select('id, description')
      .eq('quote_id', quote.id)
    expect(unchangedItemsError).toBeNull()
    expect(unchangedItems).toEqual([{ id: item.id, description: 'Draft line' }])

    const { error: conversionError } = await tenantA.client.from('quotes')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('id', quote.id)
    expect(conversionError).toBeNull()

    const stillLocked = await tenantA.client.from('quote_sections')
      .update({ title: 'Changed after conversion' })
      .eq('id', section.id)
      .select('id')
    expectBlocked(stillLocked)
    const { data: convertedQuote, error: convertedQuoteError } = await admin.from('quotes')
      .select('status, converted_at, signature_token, signature_token_expires_at')
      .eq('id', quote.id)
      .single()
    expect(convertedQuoteError).toBeNull()
    expect(convertedQuote).toMatchObject({
      status: 'converted',
      signature_token: null,
      signature_token_expires_at: null,
    })
    expect(convertedQuote?.converted_at).not.toBeNull()
    const { data: finalSections, error: finalSectionsError } = await admin.from('quote_sections')
      .select('id, title')
      .eq('quote_id', quote.id)
    expect(finalSectionsError).toBeNull()
    expect(finalSections).toEqual([{ id: section.id, title: 'Legitimately edited while draft' }])
    const { data: finalItems, error: finalItemsError } = await admin.from('quote_items')
      .select('id, description')
      .eq('quote_id', quote.id)
    expect(finalItemsError).toBeNull()
    expect(finalItems).toEqual([{ id: item.id, description: 'Draft line' }])
  })

  it('does not expose invoice or quote numbering SECURITY DEFINER RPCs to anon', async () => {
    const baseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
    const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey) throw new Error('SUPABASE_ANON_KEY requis pour les tests d’isolation')

    for (const name of ['generate_invoice_number', 'generate_quote_number']) {
      const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: tenantA.orgId }),
      })
      expect([401, 403, 404]).toContain(response.status)
    }
  })

  it('restricts the account-cleanup completion marker to server writes', async () => {
    const admin = adminClient()
    const { data: current, error: currentError } = await admin.from('organizations')
      .select('deletion_cleanup_completed_at')
      .eq('id', tenantA.orgId)
      .single()
    expect(currentError).toBeNull()
    expect(current).not.toBeNull()
    if (!current) return

    const completedAt = new Date().toISOString()
    try {
      const clientWrite = await tenantA.client.from('organizations')
        .update({ deletion_cleanup_completed_at: completedAt })
        .eq('id', tenantA.orgId)
        .select('id')
      expectBlocked(clientWrite)
      const { data: afterClientWrite, error: afterClientWriteError } = await admin.from('organizations')
        .select('deletion_cleanup_completed_at')
        .eq('id', tenantA.orgId)
        .single()
      expect(afterClientWriteError).toBeNull()
      expect(afterClientWrite?.deletion_cleanup_completed_at).toBe(current.deletion_cleanup_completed_at)

      const serverWrite = await admin.from('organizations')
        .update({ deletion_cleanup_completed_at: completedAt })
        .eq('id', tenantA.orgId)
      expect(serverWrite.error).toBeNull()

      const { data: persisted, error: persistedError } = await admin.from('organizations')
        .select('deletion_cleanup_completed_at')
        .eq('id', tenantA.orgId)
        .single()
      expect(persistedError).toBeNull()
      expect(Date.parse(persisted?.deletion_cleanup_completed_at ?? '')).toBe(Date.parse(completedAt))
    } finally {
      const { error: restoreError } = await admin.from('organizations')
        .update({ deletion_cleanup_completed_at: current.deletion_cleanup_completed_at })
        .eq('id', tenantA.orgId)
      if (restoreError) throw new Error(`Deletion cleanup marker restore failed: ${restoreError.message}`)
    }
  })

  it('denies numbering to viewer, preserves counters, and allows owner use', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin.from('organizations')
      .select('last_invoice_number, last_quote_number')
      .eq('id', tenantA.orgId)
      .single()
    expect(beforeError).toBeNull()

    const deniedInvoice = await viewerA.client.rpc('generate_invoice_number', { org_id: tenantA.orgId })
    const deniedQuote = await viewerA.client.rpc('generate_quote_number', { org_id: tenantA.orgId })
    expectBlocked(deniedInvoice)
    expectBlocked(deniedQuote)

    const { data: unchanged, error: unchangedError } = await admin.from('organizations')
      .select('last_invoice_number, last_quote_number')
      .eq('id', tenantA.orgId)
      .single()
    expect(unchangedError).toBeNull()
    expect(unchanged).toEqual(before)

    const { data: invoiceNumber, error: invoiceNumberError } = await tenantA.client.rpc(
      'generate_invoice_number',
      { org_id: tenantA.orgId },
    )
    expect(invoiceNumberError).toBeNull()
    expect(invoiceNumber).toMatch(/^FAC-/)

    const { data: quoteNumber, error: quoteNumberError } = await tenantA.client.rpc(
      'generate_quote_number',
      { org_id: tenantA.orgId },
    )
    expect(quoteNumberError).toBeNull()
    expect(quoteNumber).toMatch(/^DEV-/)
  })

  it('does not let an owner create a second owner through membership role edits', async () => {
    const admin = adminClient()
    const [{ data: membership, error: membershipError }, { data: ownerRole, error: ownerRoleError }] = await Promise.all([
      admin.from('memberships')
        .select('id, role_id')
        .eq('organization_id', tenantA.orgId)
        .eq('user_id', viewerA.userId)
        .single(),
      admin.from('roles')
        .select('id')
        .eq('organization_id', tenantA.orgId)
        .eq('slug', 'owner')
        .single(),
    ])
    expect(membershipError).toBeNull()
    expect(ownerRoleError).toBeNull()
    expect(membership).not.toBeNull()
    expect(ownerRole).not.toBeNull()
    if (!membership || !ownerRole) return

    const attempt = await tenantA.client.from('memberships')
      .update({ role_id: ownerRole.id })
      .eq('id', membership.id)
      .select('id')
    expectBlocked(attempt)

    const { data: unchanged, error: unchangedError } = await admin.from('memberships')
      .select('role_id')
      .eq('id', membership.id)
      .single()
    expect(unchangedError).toBeNull()
    expect(unchanged?.role_id).toBe(membership.role_id)
  })


  it('does not let an owner demote another owner through membership role edits', async () => {
    const admin = adminClient()
    const [{ data: ownerRole, error: ownerRoleError }, { data: viewerRole, error: viewerRoleError }] = await Promise.all([
      admin.from('roles').select('id').eq('organization_id', tenantA.orgId).eq('slug', 'owner').single(),
      admin.from('roles').select('id').eq('organization_id', tenantA.orgId).eq('slug', 'viewer').single(),
    ])
    expect(ownerRoleError).toBeNull()
    expect(viewerRoleError).toBeNull()
    expect(ownerRole).not.toBeNull()
    expect(viewerRole).not.toBeNull()
    if (!ownerRole || !viewerRole) return

    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email: `isolation-owner-target-${randomUUID()}@atelier-btp.test`,
      password: `IsolationOwnerTarget-${randomUUID()}!`,
      email_confirm: true,
    })
    expect(userError).toBeNull()
    expect(userData.user).not.toBeNull()
    const targetUser = userData.user
    if (!targetUser) return

    let temporaryOrganizationId: string | null = null
    try {
      const { data: ownMembership, error: ownMembershipError } = await admin.from('memberships')
        .select('organization_id')
        .eq('user_id', targetUser.id)
        .eq('is_active', true)
        .maybeSingle()
      expect(ownMembershipError).toBeNull()
      expect(ownMembership).not.toBeNull()
      if (!ownMembership) throw new Error('Temporary owner user membership was not created')
      temporaryOrganizationId = ownMembership.organization_id

      const { data: targetMembership, error: targetMembershipError } = await admin.from('memberships').insert({
        organization_id: tenantA.orgId,
        user_id: targetUser.id,
        role_id: ownerRole.id,
        is_active: true,
        accepted_at: new Date().toISOString(),
      }).select('id').single()
      expect(targetMembershipError).toBeNull()
      expect(targetMembership).not.toBeNull()
      if (!targetMembership) return

      const demotion = await tenantA.client.from('memberships')
        .update({ role_id: viewerRole.id })
        .eq('id', targetMembership.id)
        .select('id')
      expectBlocked(demotion)
      const { data: unchangedTarget, error: unchangedTargetError } = await admin.from('memberships')
        .select('role_id')
        .eq('id', targetMembership.id)
        .single()
      expect(unchangedTargetError).toBeNull()
      expect(unchangedTarget?.role_id).toBe(ownerRole.id)
    } finally {
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(targetUser.id)
      if (deleteUserError) throw new Error(`Temporary owner user cleanup failed: ${deleteUserError.message}`)
      if (temporaryOrganizationId) {
        const { error: deleteOrgError } = await admin.from('organizations').delete().eq('id', temporaryOrganizationId)
        if (deleteOrgError) throw new Error(`Temporary owner organization cleanup failed: ${deleteOrgError.message}`)
      }
    }
  })

  it('allows an owner to manage another member role permissions', async () => {
    const admin = adminClient()
    const { data: membership, error: membershipError } = await admin.from('memberships')
      .select('role_id')
      .eq('organization_id', tenantA.orgId)
      .eq('user_id', viewerA.userId)
      .single()
    expect(membershipError).toBeNull()
    expect(membership).not.toBeNull()
    if (!membership) return

    const { data: permission, error: permissionError } = await admin.from('role_permissions')
      .select('id, is_allowed')
      .eq('role_id', membership.role_id)
      .eq('permission_key', 'invoices.record_payment')
      .single()
    expect(permissionError).toBeNull()
    expect(permission).not.toBeNull()
    if (!permission) return
    const original = permission.is_allowed

    try {
      const { data: changed, error: changeError } = await tenantA.client.from('role_permissions')
        .update({ is_allowed: !original })
        .eq('id', permission.id)
        .select('is_allowed')
        .single()
      expect(changeError).toBeNull()
      expect(changed?.is_allowed).toBe(!original)

      const { data: persisted, error: persistedError } = await admin.from('role_permissions')
        .select('is_allowed')
        .eq('id', permission.id)
        .single()
      expect(persistedError).toBeNull()
      expect(persisted?.is_allowed).toBe(!original)
    } finally {
      const { error: restoreError } = await admin.from('role_permissions')
        .update({ is_allowed: original })
        .eq('id', permission.id)
      if (restoreError) throw new Error(`Permission fixture restore failed: ${restoreError.message}`)
    }
  })

  it('does not let a viewer grant itself invoice permissions through role_permissions', async () => {
    const admin = adminClient()
    const { data: membership, error: membershipError } = await admin.from('memberships')
      .select('role_id')
      .eq('organization_id', tenantA.orgId)
      .eq('user_id', viewerA.userId)
      .single()
    expect(membershipError).toBeNull()
    expect(membership).not.toBeNull()
    if (!membership) return

    const { data: paymentPermission, error: permissionError } = await admin.from('role_permissions')
      .select('id, is_allowed')
      .eq('role_id', membership.role_id)
      .eq('permission_key', 'invoices.record_payment')
      .single()
    expect(permissionError).toBeNull()
    expect(paymentPermission).not.toBeNull()
    if (!paymentPermission) return
    const original = paymentPermission.is_allowed

    try {
      if (original) {
        const { error: disableError } = await admin.from('role_permissions')
          .update({ is_allowed: false })
          .eq('id', paymentPermission.id)
        expect(disableError).toBeNull()
      }

      const attack = await viewerA.client.from('role_permissions')
        .update({ is_allowed: true })
        .eq('id', paymentPermission.id)
        .select('id')
      expectBlocked(attack)

      const { data: after, error: afterError } = await admin.from('role_permissions')
        .select('is_allowed')
        .eq('id', paymentPermission.id)
        .single()
      expect(afterError).toBeNull()
      expect(after?.is_allowed).toBe(false)
    } finally {
      if (original) {
        const { error: restoreError } = await admin.from('role_permissions')
          .update({ is_allowed: original })
          .eq('id', paymentPermission.id)
        if (restoreError) throw new Error(`Viewer permission restore failed: ${restoreError.message}`)
      }
    }
  })
})
