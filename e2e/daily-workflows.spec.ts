import { test, expect, emailHasPdfAttachment, emailRecipients, extractSignatureLink, signatureLinkIsLocal, waitForEmailCount } from './fixtures'
import type { Page } from '@playwright/test'
import type { QualificationTenant } from './fixtures'
const QUALIFICATION_QUANTITY = 2
const QUALIFICATION_UNIT_PRICE = 500
const EXPECTED_TOTAL_HT = 1000
const EXPECTED_TOTAL_TVA = 200
const EXPECTED_TOTAL_TTC = 1200
const QUALIFICATION_DESCRIPTION = 'Prestation de qualification'

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function euroPattern(amount: number): RegExp {
  const [integer, decimals] = amount.toFixed(2).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]?')
  return new RegExp(`${grouped},${decimals}\\s*[\\u00a0\\u202f]?€`)
}

function normalizedEmailBody(email: { html?: string; text?: string }): string {
  return `${email.html ?? ''} ${email.text ?? ''}`.replace(/[\s\u00a0\u202f]+/g, ' ')
}

async function signInAsOwner(page: Page, tenant: QualificationTenant): Promise<void> {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.locator('input[name="email"]').fill(tenant.email)
  await page.locator('input[name="password"]').fill(tenant.password)
  await page.getByRole('button', { name: /se connecter/i }).click()
  await page.waitForURL((url: URL) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
}

async function createQuoteInUi(page: Page, tenant: QualificationTenant, title: string): Promise<void> {
  await page.goto('/finances/quote-editor?returnTo=%2Ffinances')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Je fais le devis moi-même' }).click()
  await page.locator('#quote-info select').selectOption(tenant.clientId)
  await page.getByPlaceholder('Ex: Rénovation toiture').fill(title)

  await page.getByRole('button', { name: 'Ajouter une section' }).first().click()
  await page.getByRole('button', { name: 'Saisie libre' }).click()

  const description = page.getByPlaceholder('Désignation...')
  await expect(description).toBeVisible()
  await description.fill(QUALIFICATION_DESCRIPTION)
  const row = description.locator('xpath=../../..')
  const numericInputs = row.locator('input:visible')
  await expect(numericInputs).toHaveCount(3)
  await numericInputs.nth(0).fill(String(QUALIFICATION_QUANTITY))
  await numericInputs.nth(0).press('Tab')
  await numericInputs.nth(1).fill(String(QUALIFICATION_UNIT_PRICE))
  await numericInputs.nth(1).press('Tab')
}

async function readQuote(tenant: QualificationTenant, title: string) {
  const { data, error } = await tenant.admin
    .from('quotes')
    .select('id, title, status, client_id, total_ht, total_tva, total_ttc, sent_at, accepted_at, signed_at, document_snapshot')
    .eq('organization_id', tenant.orgId)
    .eq('title', title)
    .maybeSingle()
  if (error) throw new Error('Could not read the qualification quote from the local database.')
  return data
}

async function quoteItems(tenant: QualificationTenant, quoteId: string) {
  const { data, error } = await tenant.admin
    .from('quote_items')
    .select('description, quantity, unit_price, vat_rate, total_ht')
    .eq('quote_id', quoteId)
  if (error) throw new Error('Could not read qualification quote lines from the local database.')
  return data ?? []
}

async function waitForPersistedDraft(tenant: QualificationTenant, title: string) {
  await expect.poll(async () => {
    const quote = await readQuote(tenant, title)
    if (!quote || quote.status !== 'draft' || quote.client_id !== tenant.clientId) return false
    const items = await quoteItems(tenant, quote.id)
    return items.length === 1
      && items[0].description === QUALIFICATION_DESCRIPTION
      && Number(items[0].quantity) === QUALIFICATION_QUANTITY
      && Number(items[0].unit_price) === QUALIFICATION_UNIT_PRICE
      && Number(items[0].vat_rate) === 20
      && Number(quote.total_ht) === EXPECTED_TOTAL_HT
      && Number(quote.total_tva) === EXPECTED_TOTAL_TVA
      && Number(quote.total_ttc) === EXPECTED_TOTAL_TTC
  }, { timeout: 30_000, intervals: [100, 250, 500, 1000] }).toBe(true)
  const quote = await readQuote(tenant, title)
  if (!quote) throw new Error('Qualification quote was not persisted.')
  return quote
}

async function publishQuote(page: Page): Promise<void> {
  await page.getByRole('button', { name: /PDF & email/ }).click()
  const heading = page.getByRole('heading', { name: 'Envoyer le devis' })
  await expect(heading).toBeVisible({ timeout: 30_000 })
  await page.locator('.card').filter({ has: heading }).getByRole('button', { name: 'Envoyer', exact: true }).click()
  await page.waitForURL(/\/finances(?:$|\?)/, { timeout: 30_000 })
}

async function waitForQuoteStatus(tenant: QualificationTenant, title: string, status: 'sent' | 'accepted') {
  await expect.poll(async () => {
    const quote = await readQuote(tenant, title)
    if (!quote) return false
    const published = status === 'sent'
      ? quote.status === 'sent' && Boolean(quote.sent_at) && Boolean(quote.document_snapshot)
      : quote.status === 'accepted' && Boolean(quote.accepted_at) && Boolean(quote.signed_at)
    return published
      && Number(quote.total_ht) === EXPECTED_TOTAL_HT
      && Number(quote.total_tva) === EXPECTED_TOTAL_TVA
      && Number(quote.total_ttc) === EXPECTED_TOTAL_TTC
  }, { timeout: 30_000, intervals: [100, 250, 500, 1000] }).toBe(true)
  const quote = await readQuote(tenant, title)
  if (!quote) throw new Error('Qualification quote was not persisted.')
  return quote
}

async function persistedQuoteLineIsValid(tenant: QualificationTenant, quoteId: string): Promise<boolean> {
  const items = await quoteItems(tenant, quoteId)
  return items.length === 1
    && items[0].description === QUALIFICATION_DESCRIPTION
    && Number(items[0].quantity) === QUALIFICATION_QUANTITY
    && Number(items[0].unit_price) === QUALIFICATION_UNIT_PRICE
    && Number(items[0].vat_rate) === 20
    && Number(items[0].total_ht) === EXPECTED_TOTAL_HT
}

async function waitForPublishedQuote(page: Page, tenant: QualificationTenant, title: string) {
  await publishQuote(page)
  const quote = await waitForQuoteStatus(tenant, title, 'sent')
  expect(await persistedQuoteLineIsValid(tenant, quote.id)).toBe(true)
  const emails = await waitForEmailCount(1)
  const email = emails.find((message) => emailRecipients(message).includes(tenant.clientEmail))
  expect(Boolean(email)).toBe(true)
  if (!email) throw new Error('The qualification email to the quote recipient was not captured.')
  expect(normalizedEmailBody(email)).toContain('1 200,00 €')
  expect(emailRecipients(email)).toContain(tenant.clientEmail)
  expect(emailHasPdfAttachment(email)).toBe(true)
  const signLink = extractSignatureLink(email, tenant.baseUrl)
  expect(signatureLinkIsLocal(signLink, tenant.baseUrl)).toBe(true)
  if (!signLink) throw new Error('The captured quote email did not contain a local signature link.')
  return { quote, email, signLink }
}

async function navigateToSignatureLink(page: Page, link: string): Promise<void> {
  try {
    await page.goto(link)
  } catch {
    throw new Error('The captured local signature link could not be opened.')
  }
  await page.evaluate(async () => { await document.fonts.ready })
}
async function openSignatureAsRecipient(page: Page, link: string): Promise<void> {
  await page.context().clearCookies()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await navigateToSignatureLink(page, link)
}

async function signQuoteAsRecipient(page: Page, tenant: QualificationTenant, link: string): Promise<void> {
  const ownerViewport = page.viewportSize()
  await openSignatureAsRecipient(page, link)
  await expect(page.getByText('Montant TTC', { exact: true })).toBeVisible()
  await expect(page.getByText(tenant.clientName, { exact: true })).toBeVisible()
  await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TTC)).first()).toBeVisible()
  await page.getByPlaceholder('Prénom et nom').fill('Camille Qualification')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  await canvas.scrollIntoViewIfNeeded()
  await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => {
    const rect = element.getBoundingClientRect()
    return Math.abs((rect.width / rect.height) / (element.width / element.height) - 1)
  })).toBeLessThan(0.01)
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('The local signature pad is unavailable.')
  const left = bounds.x + bounds.width * 0.2
  const top = bounds.y + bounds.height * 0.6
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.35, { steps: 5 })
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.62, { steps: 5 })
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.4, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /J'accepte ce devis/ }).click()
  await expect(page.getByRole('heading', { name: /devis accepté/i })).toBeVisible()
  await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TTC))).toBeVisible()
  if (ownerViewport) await page.setViewportSize(ownerViewport)
}

async function createAndAcceptQuote(page: Page, tenant: QualificationTenant, title: string) {
  await signInAsOwner(page, tenant)
  await createQuoteInUi(page, tenant, title)
  await waitForPersistedDraft(tenant, title)
  const published = await waitForPublishedQuote(page, tenant, title)
  await signQuoteAsRecipient(page, tenant, published.signLink)
  const accepted = await waitForQuoteStatus(tenant, title, 'accepted')
  const { data: persisted, error } = await tenant.admin
    .from('quotes')
    .select('id, status, client_signatory_name, client_signature_image, total_ht, total_tva, total_ttc')
    .eq('id', accepted.id)
    .eq('organization_id', tenant.orgId)
    .single()
  if (error || !persisted) throw new Error('Could not verify the locally signed qualification quote.')
  expect(persisted.status).toBe('accepted')
  expect(persisted.client_signatory_name).toBe('Camille Qualification')
  expect(Boolean(persisted.client_signature_image)).toBe(true)
  expect(Number(persisted.total_ht)).toBe(EXPECTED_TOTAL_HT)
  expect(Number(persisted.total_tva)).toBe(EXPECTED_TOTAL_TVA)
  expect(Number(persisted.total_ttc)).toBe(EXPECTED_TOTAL_TTC)
  return { quote: accepted, signLink: published.signLink }
}

async function createIssuedInvoiceFromAcceptedQuote(page: Page, tenant: QualificationTenant, quoteTitle: string): Promise<void> {
  await page.goto('/finances/invoice-editor?returnTo=%2Ffinances')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Sélectionner un devis' }).click()
  await expect(page.getByRole('heading', { name: 'Importer un devis accepté' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(escapeRegex(quoteTitle)) }).click()
  await expect(page.getByPlaceholder('Ex : Travaux de toiture - Bâtiment A')).toHaveValue(quoteTitle)
  await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TTC)).first()).toBeVisible()

  await page.getByRole('button', { name: /Valider\s*&\s*Envoyer/ }).click()
  await expect(page.getByRole('heading', { name: 'Envoyer la facture' })).toBeVisible()
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click()

  await page.waitForURL(/\/finances(?:$|\?)/, { timeout: 30_000 })
  await page.getByRole('radio', { name: 'Factures', exact: true }).check()
  const invoiceRow = page.getByRole('main').getByRole('listitem').filter({ hasText: quoteTitle })
  await expect(invoiceRow).toContainText('Envoyée')
}

async function waitForIssuedInvoice(tenant: QualificationTenant, quoteId: string) {
  await expect.poll(async () => {
    const { data: invoice, error } = await tenant.admin
      .from('invoices')
      .select('id, number, title, status, quote_id, client_id, total_ht, total_tva, total_ttc, sent_at, issuance_snapshot')
      .eq('organization_id', tenant.orgId)
      .eq('quote_id', quoteId)
      .maybeSingle()
    return !error && Boolean(invoice)
      && invoice?.status === 'sent'
      && Boolean(invoice.sent_at)
      && Boolean(invoice.issuance_snapshot)
      && Number(invoice.total_ht) === EXPECTED_TOTAL_HT
      && Number(invoice.total_tva) === EXPECTED_TOTAL_TVA
      && Number(invoice.total_ttc) === EXPECTED_TOTAL_TTC
  }, { timeout: 30_000, intervals: [100, 250, 500, 1000] }).toBe(true)

  const { data: invoice, error } = await tenant.admin
    .from('invoices')
    .select('id, number, title, status, quote_id, client_id, total_ht, total_tva, total_ttc, sent_at, issuance_snapshot')
    .eq('organization_id', tenant.orgId)
    .eq('quote_id', quoteId)
    .single()
  if (error || !invoice) throw new Error('The qualification invoice was not persisted.')
  const { data: items, error: itemsError } = await tenant.admin
    .from('invoice_items')
    .select('description, quantity, unit_price, vat_rate')
    .eq('invoice_id', invoice.id)
    .neq('unit', '__section__')
  if (itemsError || !items) throw new Error('Could not read the qualification invoice lines.')
  expect(items.length).toBe(1)
  expect(items[0].description).toBe(QUALIFICATION_DESCRIPTION)
  expect(Number(items[0].quantity)).toBe(QUALIFICATION_QUANTITY)
  expect(Number(items[0].unit_price)).toBe(QUALIFICATION_UNIT_PRICE)
  expect(Number(items[0].vat_rate)).toBe(20)
  expect(invoice.quote_id).toBe(quoteId)
  expect(invoice.client_id).toBe(tenant.clientId)
  expect(invoice.issuance_snapshot).toMatchObject({
    invoice: {
      id: invoice.id,
      quote_id: quoteId,
      client_id: tenant.clientId,
      total_ht: EXPECTED_TOTAL_HT,
      total_tva: EXPECTED_TOTAL_TVA,
      total_ttc: EXPECTED_TOTAL_TTC,
      currency: 'EUR',
    },
    buyer: { id: tenant.clientId, email: tenant.clientEmail },
    items: expect.arrayContaining([expect.objectContaining({
      description: QUALIFICATION_DESCRIPTION,
      quantity: QUALIFICATION_QUANTITY,
      unit_price: QUALIFICATION_UNIT_PRICE,
      vat_rate: 20,
    })]),
  })
  return invoice
}

test.describe('Parcours métier Atelier : qualification locale isolée', () => {
  test('créer un devis et retrouver ses lignes et montants persistés', async ({ page, qualification }) => {
    await signInAsOwner(page, qualification)
    const title = `Devis qualification ${qualification.orgId.slice(0, 8)}`
    await createQuoteInUi(page, qualification, title)
    await expect(page.getByText(euroPattern(EXPECTED_TOTAL_HT)).first()).toBeVisible()
    await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TVA)).first()).toBeVisible()
    await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TTC)).first()).toBeVisible()

    const quote = await waitForPersistedDraft(qualification, title)
    expect(quote.status).toBe('draft')
    expect(quote.client_id).toBe(qualification.clientId)
    expect(await persistedQuoteLineIsValid(qualification, quote.id)).toBe(true)
  })

  test('envoyer un devis au destinataire avec lien local et PDF réel', async ({ page, qualification }) => {
    await signInAsOwner(page, qualification)
    const title = `Devis envoyé qualification ${qualification.orgId.slice(0, 8)}`
    await createQuoteInUi(page, qualification, title)
    await waitForPersistedDraft(qualification, title)
    const { quote, email, signLink } = await waitForPublishedQuote(page, qualification, title)

    expect(quote.status).toBe('sent')
    expect(quote.sent_at).toBeTruthy()
    expect(emailRecipients(email)).toEqual([qualification.clientEmail])
    expect(emailHasPdfAttachment(email)).toBe(true)
    expect(signatureLinkIsLocal(signLink, qualification.baseUrl)).toBe(true)
    await openSignatureAsRecipient(page, signLink)
    await expect(page.getByText(qualification.clientName, { exact: true })).toBeVisible()
    await expect(page.getByText(euroPattern(EXPECTED_TOTAL_TTC))).toBeVisible()
    await expect(page.getByPlaceholder('Prénom et nom')).toBeVisible()
  })

  test('facturer un devis accepté en conservant le devis et ses montants', async ({ page, qualification }) => {
    const title = `Devis à facturer qualification ${qualification.orgId.slice(0, 8)}`
    const { quote } = await createAndAcceptQuote(page, qualification, title)
    const confirmationEmails = await waitForEmailCount(3)
    expect(confirmationEmails.filter((email) => emailRecipients(email).includes(qualification.clientEmail))).toHaveLength(2)

    await signInAsOwner(page, qualification)
    await createIssuedInvoiceFromAcceptedQuote(page, qualification, title)
    const invoice = await waitForIssuedInvoice(qualification, quote.id)
    expect(invoice.status).toBe('sent')
    expect(invoice.sent_at).toBeTruthy()
    expect(Number(invoice.total_ht)).toBe(EXPECTED_TOTAL_HT)
    expect(Number(invoice.total_tva)).toBe(EXPECTED_TOTAL_TVA)
    expect(Number(invoice.total_ttc)).toBe(EXPECTED_TOTAL_TTC)

    const emails = await waitForEmailCount(4)
    const invoiceEmail = emails.find((email) =>
      emailRecipients(email).includes(qualification.clientEmail)
      && emailHasPdfAttachment(email)
      && Boolean(invoice.number && email.subject?.includes(invoice.number))
      && normalizedEmailBody(email).includes('1 200,00 €'),
    )
    expect(Boolean(invoiceEmail)).toBe(true)
  })

  test('ajouter un client qualification depuis le formulaire métier', async ({ page, qualification }) => {
    await signInAsOwner(page, qualification)
    await page.goto('/clients')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Nouveau Client', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Nouveau Client' })).toBeVisible()

    const clientName = `Client créé qualification ${qualification.orgId.slice(0, 8)}`
    const clientEmail = `qualification-created-${qualification.orgId.slice(0, 8)}@atelier.test`
    await page.locator('input[name="company_name"]').fill(clientName)
    await page.locator('input[name="contact_name"]').fill('Sacha Qualification')
    await page.locator('input[name="email"]').fill(clientEmail)
    await page.getByRole('button', { name: 'Créer le client' }).click()

    await expect(page.getByRole('heading', { name: 'Nouveau Client' })).toBeHidden()
    await expect(page.getByText(clientName, { exact: true })).toBeVisible()
    await expect(page.getByText(clientEmail, { exact: true })).toBeVisible()
    await expect.poll(async () => {
      const { data, error } = await qualification.admin
        .from('clients')
        .select('id, company_name, contact_name, email, status')
        .eq('organization_id', qualification.orgId)
        .eq('company_name', clientName)
        .maybeSingle()
      return !error && data?.contact_name === 'Sacha Qualification' && data.email === clientEmail && data.status === 'active'
    }, { timeout: 20_000, intervals: [100, 250, 500, 1000] }).toBe(true)
  })

  test('faire signer le devis par son destinataire et persister son accord', async ({ page, qualification }) => {
    const title = `Devis signé qualification ${qualification.orgId.slice(0, 8)}`
    await signInAsOwner(page, qualification)
    await createQuoteInUi(page, qualification, title)
    await waitForPersistedDraft(qualification, title)
    const { signLink } = await waitForPublishedQuote(page, qualification, title)
    await signQuoteAsRecipient(page, qualification, signLink)
    const accepted = await waitForQuoteStatus(qualification, title, 'accepted')

    const { data: persisted, error } = await qualification.admin
      .from('quotes')
      .select('id, status, accepted_at, signed_at, client_signatory_name, client_signatory_role, client_signature_image, total_ht, total_tva, total_ttc')
      .eq('id', accepted.id)
      .eq('organization_id', qualification.orgId)
      .single()
    if (error || !persisted) throw new Error('Could not verify the locally signed qualification quote.')
    expect(persisted.status).toBe('accepted')
    expect(Boolean(persisted.accepted_at)).toBe(true)
    expect(Boolean(persisted.signed_at)).toBe(true)
    expect(persisted.client_signatory_name).toBe('Camille Qualification')
    expect(Boolean(persisted.client_signature_image)).toBe(true)
    expect(Number(persisted.total_ht)).toBe(EXPECTED_TOTAL_HT)
    expect(Number(persisted.total_tva)).toBe(EXPECTED_TOTAL_TVA)
    expect(Number(persisted.total_ttc)).toBe(EXPECTED_TOTAL_TTC)
    const emails = await waitForEmailCount(3)
    expect(emails.filter((email) => emailRecipients(email).includes(qualification.clientEmail))).toHaveLength(2)
  })

  test('pointer des heures depuis le magic link intervenant à usage unique', async ({ page, qualification }) => {
    const member = await qualification.createMemberAccess()
    const link = new URL('/api/auth/member-verify', qualification.baseUrl)
    link.searchParams.set('token', member.rawToken)
    try {
      await page.goto(link.toString())
      await page.waitForLoadState('networkidle')
    } catch {
      throw new Error('The local single-use member access link could not be opened.')
    }
    expect(new URL(page.url()).pathname).toBe('/mon-espace/dashboard')
    await expect(page.getByRole('heading', { name: 'Bonjour Alex' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pointer mes heures' })).toBeVisible()

    const { data: consumedToken, error: tokenReadError } = await qualification.admin
      .from('member_space_tokens')
      .select('last_used_at')
      .eq('id', member.tokenId)
      .single()
    if (tokenReadError || !consumedToken) throw new Error('Could not verify local member token consumption.')
    expect(Boolean(consumedToken.last_used_at)).toBe(true)

    await page.getByRole('button', { name: 'Pointer mes heures' }).click()
    const form = page.getByText('Nouveau pointage').locator('..')
    await expect(form).toBeVisible()
    await form.locator('select').selectOption(member.chantierId)
    await form.locator('input[type="date"]').fill(member.date)
    await form.getByPlaceholder('ex : 7.5').fill('3.5')
    await form.getByPlaceholder('Description (facultatif)').fill('Pointage de qualification')
    await form.getByRole('button', { name: 'Pointer', exact: true }).click()
    await expect(form).toBeHidden()

    const { data: pointage, error: pointageError } = await qualification.admin
      .from('chantier_pointages')
      .select('id, chantier_id, member_id, user_id, date, hours, start_time, description, chantier:chantiers!inner(organization_id)')
      .eq('chantier.organization_id', qualification.orgId)
      .eq('member_id', member.memberId)
      .eq('chantier_id', member.chantierId)
      .maybeSingle()
    if (pointageError || !pointage) throw new Error('The qualification timesheet entry was not persisted.')
    expect(pointage.user_id).toBeNull()
    expect(pointage.date).toBe(member.date)
    expect(Number(pointage.hours)).toBe(3.5)
    expect(pointage.description).toBe('Pointage de qualification')

    await expect(page.getByRole('button').filter({ hasText: '3h30' }).last()).toBeVisible()
    await page.getByRole('button').filter({ hasText: '3h30' }).last().click()
    await expect(page.getByText(member.chantierTitle, { exact: true })).toBeVisible()
    await expect(page.getByText('Pointage de qualification', { exact: true })).toBeVisible()
  })

})
