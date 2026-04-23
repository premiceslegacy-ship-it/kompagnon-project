import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderChantierPdfBufferById, renderInvoicePdfBufferById, renderQuotePdfBufferById } from '@/lib/pdf/server'
import {
  ORGANIZATION_EXPORT_BUCKET,
  ORGANIZATION_EXPORT_KEEP_COUNT,
  ORGANIZATION_EXPORT_RETENTION_DAYS,
  type OrganizationExportSummary,
} from './shared'
import { rowsToCsv, sanitizeFileName } from './csv'

type AdminClient = ReturnType<typeof createAdminClient>

type BuildOrganizationExportBundleParams = {
  organizationId: string
  exportId: string
}

type BuildOrganizationExportBundleResult = {
  buffer: Buffer
  bundlePath: string
  fileName: string
  summary: OrganizationExportSummary
  sizeBytes: number
}

type ExportAttachment = {
  bucket: string | null
  storagePath: string | null
  url: string | null
  zipPath: string
}

function isoNow() {
  return new Date().toISOString()
}

function stripSensitiveOrganizationFields(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  return {
    ...row,
    pa_api_key_encrypted: row.pa_api_key_encrypted ? '[redacted]' : null,
    pa_webhook_secret: row.pa_webhook_secret ? '[redacted]' : null,
  }
}

function stripSensitiveWhatsappFields(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    access_token: row.access_token ? '[redacted]' : null,
    verify_token: row.verify_token ? '[redacted]' : null,
  }))
}

function stripCompanyMemoryEmbeddings(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const { embedding: _embedding, ...rest } = row
    return rest
  })
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || 'file'
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return 'bin'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('svg')) return 'svg'
  if (contentType.includes('pdf')) return 'pdf'
  if (contentType.includes('json')) return 'json'
  return 'bin'
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer())
}

async function downloadFromPublicUrl(url: string): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return {
      buffer: await blobToBuffer(blob),
      contentType: res.headers.get('content-type'),
    }
  } catch {
    return null
  }
}

async function downloadFromStorage(
  admin: AdminClient,
  bucket: string,
  storagePath: string,
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const { data, error } = await admin.storage.from(bucket).download(storagePath)
  if (error || !data) return null
  return {
    buffer: await blobToBuffer(data),
    contentType: data.type || null,
  }
}

async function fetchOrgRows(
  admin: AdminClient,
  table: string,
  organizationId: string,
  orderBy?: string,
): Promise<Array<Record<string, unknown>>> {
  let query: any = admin.from(table).select('*').eq('organization_id', organizationId)
  if (orderBy) query = query.order(orderBy, { ascending: true })
  const { data, error } = await query
  if (error) {
    console.error(`[organization-exports] ${table}:`, error.message)
    return []
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

async function fetchRowsByForeignKey(
  admin: AdminClient,
  table: string,
  foreignKey: string,
  ids: string[],
  orderBy?: string,
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return []
  let query: any = admin.from(table).select('*').in(foreignKey, ids)
  if (orderBy) query = query.order(orderBy, { ascending: true })
  const { data, error } = await query
  if (error) {
    console.error(`[organization-exports] ${table}:`, error.message)
    return []
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

function addCsvFile(
  zip: JSZip,
  path: string,
  rows: Array<Record<string, unknown>>,
  summary: OrganizationExportSummary,
) {
  zip.file(path, rowsToCsv(rows))
  const key = path.replace(/^csv\//, '').replace(/\.csv$/, '')
  summary.counts[key] = rows.length
}

async function addFileToZip(
  zip: JSZip,
  admin: AdminClient,
  attachment: ExportAttachment,
  summary: OrganizationExportSummary,
  warnings: string[],
) {
  let result: { buffer: Buffer; contentType: string | null } | null = null

  if (attachment.bucket && attachment.storagePath) {
    result = await downloadFromStorage(admin, attachment.bucket, attachment.storagePath)
  } else if (attachment.url) {
    result = await downloadFromPublicUrl(attachment.url)
  }

  if (!result) {
    warnings.push(`Impossible de telecharger ${attachment.zipPath}.`)
    return
  }

  zip.file(attachment.zipPath, result.buffer)
  const folder = attachment.zipPath.split('/').slice(0, -1).join('/')
  summary.files[folder] = (summary.files[folder] ?? 0) + 1
}

function parseQuoteRequestAttachments(request: Record<string, unknown>): ExportAttachment[] {
  const requestId = String(request.id ?? 'request')
  const attachments = Array.isArray(request.attachments) ? request.attachments : []
  const parsed: ExportAttachment[] = []

  attachments.forEach((attachment, index) => {
    if (!attachment || typeof attachment !== 'object') return
    const row = attachment as Record<string, unknown>
    const storagePath = typeof row.storage_path === 'string' ? row.storage_path : null
    const filename =
      typeof row.filename === 'string' && row.filename.trim()
        ? row.filename.trim()
        : storagePath
          ? basename(storagePath)
          : `piece-jointe-${index + 1}`

    parsed.push({
      bucket: storagePath ? 'quote-attachments' : null,
      storagePath,
      url: typeof row.url === 'string' ? row.url : null,
      zipPath: `files/quote-attachments/${requestId}/${sanitizeFileName(filename, `piece-jointe-${index + 1}`)}`,
    })
  })

  const attachmentUrl = typeof request.attachment_url === 'string' ? request.attachment_url : null
  if (attachmentUrl) {
    let fileName = basename(attachmentUrl)
    try {
      fileName = basename(new URL(attachmentUrl).pathname)
    } catch {
      // garder le basename déjà calculé
    }

    parsed.push({
      bucket: null,
      storagePath: null,
      url: attachmentUrl,
      zipPath: `files/quote-attachments/${requestId}/${sanitizeFileName(fileName, 'piece-jointe')}`,
    })
  }

  return parsed
}

async function fetchTeamMembers(admin: AdminClient, organizationId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('memberships')
    .select(`
      id,
      organization_id,
      user_id,
      role_id,
      invited_by,
      accepted_at,
      is_active,
      notes,
      created_at,
      updated_at,
      roles ( id, name, slug ),
      profiles ( full_name, email, job_title )
    `)
    .eq('organization_id', organizationId)
    .order('accepted_at', { ascending: true })

  if (error) {
    console.error('[organization-exports] memberships:', error.message)
    return []
  }

  return (data ?? []).map((row: any) => {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles

    return {
      membership_id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      role_id: row.role_id,
      role_name: role?.name ?? null,
      role_slug: role?.slug ?? null,
      invited_by: row.invited_by,
      accepted_at: row.accepted_at,
      is_active: row.is_active,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
      job_title: profile?.job_title ?? null,
    }
  })
}

async function fetchOrganizationRecord(
  admin: AdminClient,
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from('organizations').select('*').eq('id', organizationId).single()
  if (error || !data) {
    console.error('[organization-exports] organizations:', error?.message)
    return null
  }
  return stripSensitiveOrganizationFields(data as Record<string, unknown>)
}

async function fetchCompanyMemoryRows(
  admin: AdminClient,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('company_memory')
    .select('id, organization_id, type, content, metadata, source, confidence, is_active, created_at, updated_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[organization-exports] company_memory:', error.message)
    return []
  }

  return stripCompanyMemoryEmbeddings((data ?? []) as Array<Record<string, unknown>>)
}

async function fetchWhatsappConfigRows(
  admin: AdminClient,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('whatsapp_configs')
    .select('id, organization_id, phone_number_id, waba_id, access_token, verify_token, authorized_numbers, is_active, created_at, updated_at')
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[organization-exports] whatsapp_configs:', error.message)
    return []
  }

  return stripSensitiveWhatsappFields((data ?? []) as Array<Record<string, unknown>>)
}

async function fetchPdfArtifacts(
  zip: JSZip,
  organizationId: string,
  quoteIds: string[],
  invoiceIds: string[],
  chantierIds: string[],
  summary: OrganizationExportSummary,
  warnings: string[],
) {
  for (const quoteId of quoteIds) {
    const rendered = await renderQuotePdfBufferById(quoteId, organizationId)
    if (!rendered) {
      warnings.push(`Impossible de regenerer le PDF du devis ${quoteId}.`)
      continue
    }
    zip.file(`pdfs/quotes/${rendered.fileName}`, rendered.buffer)
    summary.files['pdfs/quotes'] = (summary.files['pdfs/quotes'] ?? 0) + 1
  }

  for (const invoiceId of invoiceIds) {
    const rendered = await renderInvoicePdfBufferById(invoiceId, organizationId)
    if (!rendered) {
      warnings.push(`Impossible de regenerer le PDF de la facture ${invoiceId}.`)
      continue
    }
    zip.file(`pdfs/invoices/${rendered.fileName}`, rendered.buffer)
    summary.files['pdfs/invoices'] = (summary.files['pdfs/invoices'] ?? 0) + 1
  }

  for (const chantierId of chantierIds) {
    const rendered = await renderChantierPdfBufferById(chantierId, organizationId)
    if (!rendered) {
      warnings.push(`Impossible de regenerer le PDF du chantier ${chantierId}.`)
      continue
    }
    zip.file(`pdfs/chantiers/${rendered.fileName}`, rendered.buffer)
    summary.files['pdfs/chantiers'] = (summary.files['pdfs/chantiers'] ?? 0) + 1
  }
}

export async function cleanupOrganizationExports(
  admin: AdminClient,
  organizationId: string,
) {
  const { data, error } = await admin
    .from('organization_exports')
    .select('id, status, bundle_path, created_at, expires_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    if (error) console.error('[organization-exports] cleanup:', error.message)
    return
  }

  const now = Date.now()
  const readyRows = data.filter((row) => row.status === 'ready')
  const rowsToExpire = readyRows.filter((row, index) => {
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null
    const isPastRetention = expiresAt !== null && expiresAt <= now
    const exceedsKeepCount = index >= ORGANIZATION_EXPORT_KEEP_COUNT
    return isPastRetention || exceedsKeepCount
  })

  for (const row of rowsToExpire) {
    if (row.bundle_path) {
      await admin.storage.from(ORGANIZATION_EXPORT_BUCKET).remove([row.bundle_path])
    }

    await admin
      .from('organization_exports')
      .update({
        status: 'expired',
        bundle_path: null,
      })
      .eq('id', row.id)
  }
}

export async function buildOrganizationExportBundle({
  organizationId,
  exportId,
}: BuildOrganizationExportBundleParams): Promise<BuildOrganizationExportBundleResult> {
  const admin = createAdminClient()
  const zip = new JSZip()
  const summary: OrganizationExportSummary = {
    counts: {},
    files: {},
    warnings: [],
  }

  const organization = await fetchOrganizationRecord(admin, organizationId)
  if (!organization) {
    throw new Error('Organisation introuvable pour cet export.')
  }

  const [
    roles,
    invitations,
    clients,
    quoteRequests,
    quotes,
    invoices,
    reminders,
    payments,
    recurringInvoices,
    invoiceSchedules,
    chantiers,
    chantierEquipes,
    materials,
    laborRates,
    prestationTypes,
    materialPriceVariants,
    emailTemplates,
    importJobs,
    activityLog,
    companyMemory,
    goals,
    whatsappConfigs,
    whatsappMessages,
    receivedInvoices,
    paStatusEvents,
    teamMembers,
  ] = await Promise.all([
    fetchOrgRows(admin, 'roles', organizationId, 'position'),
    fetchOrgRows(admin, 'invitations', organizationId, 'created_at'),
    fetchOrgRows(admin, 'clients', organizationId, 'created_at'),
    fetchOrgRows(admin, 'quote_requests', organizationId, 'created_at'),
    fetchOrgRows(admin, 'quotes', organizationId, 'created_at'),
    fetchOrgRows(admin, 'invoices', organizationId, 'created_at'),
    fetchOrgRows(admin, 'reminders', organizationId, 'created_at'),
    fetchOrgRows(admin, 'payments', organizationId, 'created_at'),
    fetchOrgRows(admin, 'recurring_invoices', organizationId, 'created_at'),
    fetchOrgRows(admin, 'invoice_schedules', organizationId, 'created_at'),
    fetchOrgRows(admin, 'chantiers', organizationId, 'created_at'),
    fetchOrgRows(admin, 'chantier_equipes', organizationId, 'created_at'),
    fetchOrgRows(admin, 'materials', organizationId, 'created_at'),
    fetchOrgRows(admin, 'labor_rates', organizationId, 'created_at'),
    fetchOrgRows(admin, 'prestation_types', organizationId, 'created_at'),
    fetchOrgRows(admin, 'material_price_variants', organizationId, 'position'),
    fetchOrgRows(admin, 'email_templates', organizationId, 'created_at'),
    fetchOrgRows(admin, 'import_jobs', organizationId, 'created_at'),
    fetchOrgRows(admin, 'activity_log', organizationId, 'created_at'),
    fetchCompanyMemoryRows(admin, organizationId),
    fetchOrgRows(admin, 'goals', organizationId, 'created_at'),
    fetchWhatsappConfigRows(admin, organizationId),
    fetchOrgRows(admin, 'whatsapp_messages', organizationId, 'created_at'),
    fetchOrgRows(admin, 'received_invoices', organizationId, 'created_at'),
    fetchOrgRows(admin, 'pa_status_events', organizationId, 'created_at'),
    fetchTeamMembers(admin, organizationId),
  ])

  const quoteIds = quotes.map((row) => String(row.id))
  const invoiceIds = invoices.map((row) => String(row.id))
  const recurringInvoiceIds = recurringInvoices.map((row) => String(row.id))
  const chantierIds = chantiers.map((row) => String(row.id))
  const chantierEquipeIds = chantierEquipes.map((row) => String(row.id))
  const prestationTypeIds = prestationTypes.map((row) => String(row.id))

  const [
    quoteSections,
    quoteItems,
    invoiceItems,
    recurringInvoiceItems,
    chantierTaches,
    chantierPointages,
    chantierNotes,
    chantierPhotos,
    chantierEquipeMembres,
    chantierEquipeChantiers,
    chantierPlannings,
    prestationTypeItems,
  ] = await Promise.all([
    fetchRowsByForeignKey(admin, 'quote_sections', 'quote_id', quoteIds, 'position'),
    fetchRowsByForeignKey(admin, 'quote_items', 'quote_id', quoteIds, 'position'),
    fetchRowsByForeignKey(admin, 'invoice_items', 'invoice_id', invoiceIds, 'position'),
    fetchRowsByForeignKey(admin, 'recurring_invoice_items', 'recurring_invoice_id', recurringInvoiceIds, 'position'),
    fetchRowsByForeignKey(admin, 'chantier_taches', 'chantier_id', chantierIds, 'position'),
    fetchRowsByForeignKey(admin, 'chantier_pointages', 'chantier_id', chantierIds, 'date'),
    fetchRowsByForeignKey(admin, 'chantier_notes', 'chantier_id', chantierIds, 'created_at'),
    fetchRowsByForeignKey(admin, 'chantier_photos', 'chantier_id', chantierIds, 'created_at'),
    fetchRowsByForeignKey(admin, 'chantier_equipe_membres', 'equipe_id', chantierEquipeIds, 'created_at'),
    fetchRowsByForeignKey(admin, 'chantier_equipe_chantiers', 'equipe_id', chantierEquipeIds, 'created_at'),
    fetchRowsByForeignKey(admin, 'chantier_plannings', 'chantier_id', chantierIds, 'planned_date'),
    fetchRowsByForeignKey(admin, 'prestation_type_items', 'prestation_type_id', prestationTypeIds, 'position'),
  ])

  addCsvFile(zip, 'csv/organization.csv', organization ? [organization] : [], summary)
  addCsvFile(zip, 'csv/team_members.csv', teamMembers, summary)
  addCsvFile(zip, 'csv/roles.csv', roles, summary)
  addCsvFile(zip, 'csv/invitations.csv', invitations, summary)
  addCsvFile(zip, 'csv/clients.csv', clients, summary)
  addCsvFile(zip, 'csv/quote_requests.csv', quoteRequests, summary)
  addCsvFile(zip, 'csv/quotes.csv', quotes, summary)
  addCsvFile(zip, 'csv/quote_sections.csv', quoteSections, summary)
  addCsvFile(zip, 'csv/quote_items.csv', quoteItems, summary)
  addCsvFile(zip, 'csv/invoices.csv', invoices, summary)
  addCsvFile(zip, 'csv/invoice_items.csv', invoiceItems, summary)
  addCsvFile(zip, 'csv/reminders.csv', reminders, summary)
  addCsvFile(zip, 'csv/payments.csv', payments, summary)
  addCsvFile(zip, 'csv/recurring_invoices.csv', recurringInvoices, summary)
  addCsvFile(zip, 'csv/recurring_invoice_items.csv', recurringInvoiceItems, summary)
  addCsvFile(zip, 'csv/invoice_schedules.csv', invoiceSchedules, summary)
  addCsvFile(zip, 'csv/chantiers.csv', chantiers, summary)
  addCsvFile(zip, 'csv/chantier_taches.csv', chantierTaches, summary)
  addCsvFile(zip, 'csv/chantier_pointages.csv', chantierPointages, summary)
  addCsvFile(zip, 'csv/chantier_notes.csv', chantierNotes, summary)
  addCsvFile(zip, 'csv/chantier_photos.csv', chantierPhotos, summary)
  addCsvFile(zip, 'csv/chantier_equipes.csv', chantierEquipes, summary)
  addCsvFile(zip, 'csv/chantier_equipe_membres.csv', chantierEquipeMembres, summary)
  addCsvFile(zip, 'csv/chantier_equipe_chantiers.csv', chantierEquipeChantiers, summary)
  addCsvFile(zip, 'csv/chantier_plannings.csv', chantierPlannings, summary)
  addCsvFile(zip, 'csv/catalog_materials.csv', materials, summary)
  addCsvFile(zip, 'csv/catalog_labor_rates.csv', laborRates, summary)
  addCsvFile(zip, 'csv/catalog_prestation_types.csv', prestationTypes, summary)
  addCsvFile(zip, 'csv/catalog_prestation_type_items.csv', prestationTypeItems, summary)
  addCsvFile(zip, 'csv/catalog_material_price_variants.csv', materialPriceVariants, summary)
  addCsvFile(zip, 'csv/email_templates.csv', emailTemplates, summary)
  addCsvFile(zip, 'csv/import_jobs.csv', importJobs, summary)
  addCsvFile(zip, 'csv/activity_log.csv', activityLog, summary)
  addCsvFile(zip, 'csv/company_memory.csv', companyMemory, summary)
  addCsvFile(zip, 'csv/goals.csv', goals, summary)
  addCsvFile(zip, 'csv/whatsapp_configs.csv', whatsappConfigs, summary)
  addCsvFile(zip, 'csv/whatsapp_messages.csv', whatsappMessages, summary)
  addCsvFile(zip, 'csv/received_invoices.csv', receivedInvoices, summary)
  addCsvFile(zip, 'csv/pa_status_events.csv', paStatusEvents, summary)

  const warnings: string[] = []

  const logoUrl = typeof organization.logo_url === 'string' ? organization.logo_url : null
  if (logoUrl) {
    const logoResult = await downloadFromPublicUrl(logoUrl)
    if (logoResult) {
      const ext = extensionFromContentType(logoResult.contentType)
      zip.file(`files/logos/${sanitizeFileName(String(organization.name ?? 'logo'), 'logo')}.${ext}`, logoResult.buffer)
      summary.files['files/logos'] = (summary.files['files/logos'] ?? 0) + 1
    } else {
      warnings.push('Impossible de telecharger le logo de l organisation.')
    }
  }

  for (const photo of chantierPhotos) {
    const storagePath = typeof photo.storage_path === 'string' ? photo.storage_path : null
    if (!storagePath) continue
    await addFileToZip(
      zip,
      admin,
      {
        bucket: 'chantier-photos',
        storagePath,
        url: null,
        zipPath: `files/chantier-photos/${String(photo.chantier_id ?? 'chantier')}/${sanitizeFileName(basename(storagePath), 'photo')}`,
      },
      summary,
      warnings,
    )
  }

  for (const quoteRequest of quoteRequests) {
    const attachments = parseQuoteRequestAttachments(quoteRequest)
    for (const attachment of attachments) {
      await addFileToZip(zip, admin, attachment, summary, warnings)
    }
  }

  await fetchPdfArtifacts(zip, organizationId, quoteIds, invoiceIds, chantierIds, summary, warnings)

  summary.warnings = warnings

  const generatedAt = isoNow()
  const fileName = `${sanitizeFileName(String(organization.name ?? organizationId), 'organisation')}-export-${generatedAt.slice(0, 10)}.zip`
  const bundlePath = `${organizationId}/${generatedAt}/${sanitizeFileName(exportId, 'export')}-${fileName}`

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        export_id: exportId,
        organization_id: organizationId,
        organization_name: organization.name ?? null,
        generated_at: generatedAt,
        retention_days: ORGANIZATION_EXPORT_RETENTION_DAYS,
        counts: summary.counts,
        files: summary.files,
        warnings: summary.warnings,
      },
      null,
      2,
    ),
  )

  const uint8Array = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const buffer = Buffer.from(uint8Array)
  return {
    buffer,
    bundlePath,
    fileName,
    summary,
    sizeBytes: buffer.byteLength,
  }
}
