'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getChantierById } from '@/lib/data/queries/chantiers'
import { getOrganization } from '@/lib/data/queries/organization'
import { renderEmailShell, renderInfoBox, escHtml } from '@/lib/email/layout'

export async function sendChantierPhotosEmail(params: {
  chantierId: string
  photoIds: string[]
  message: string
}): Promise<{ error: string | null; recipient?: string }> {
  const { chantierId, photoIds, message } = params

  if (photoIds.length === 0) return { error: 'Sélectionnez au moins une photo.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const [chantier, organization] = await Promise.all([
    getChantierById(chantierId),
    getOrganization(),
  ])

  if (!chantier)     return { error: 'Chantier introuvable.' }
  if (!organization) return { error: 'Organisation introuvable.' }

  const recipient = chantier.contact_email || chantier.client?.email
  if (!recipient) return { error: 'Aucune adresse email trouvée pour ce chantier.' }

  // Récupérer les photos sélectionnées avec leurs storage_path et caption
  const supabase = await createClient()
  const { data: photos, error: photosError } = await supabase
    .from('chantier_photos')
    .select('id, storage_path, caption')
    .in('id', photoIds)
    .eq('chantier_id', chantierId)

  if (photosError || !photos?.length) return { error: 'Impossible de récupérer les photos.' }

  // Télécharger chaque photo depuis Supabase Storage en tant que buffer
  const admin = createAdminClient()
  const attachments: Array<{ filename: string; content: Buffer }> = []

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const { data: fileData, error: dlError } = await admin.storage
      .from('chantier-photos')
      .download(photo.storage_path)

    if (dlError || !fileData) {
      console.error(`[sendChantierPhotosEmail] download error for ${photo.storage_path}:`, dlError)
      continue
    }

    const ext = photo.storage_path.split('.').pop() ?? 'jpg'
    const filename = `photo-chantier-${i + 1}${photo.caption ? '-' + photo.caption.slice(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase() : ''}.${ext}`
    attachments.push({ filename, content: Buffer.from(await fileData.arrayBuffer()) })
  }

  if (attachments.length === 0) return { error: 'Impossible de télécharger les photos sélectionnées.' }

  const recipientName = chantier.contact_name || chantier.client?.company_name || recipient

  const html = buildPhotosEmailHtml({
    message,
    recipientName,
    chantierTitle: chantier.title,
    orgName: organization.name,
    photoCount: attachments.length,
  })

  const subject = `Photos du chantier : ${chantier.title}`

  const { error } = await sendEmail({
    organizationId: orgId,
    to: recipient,
    subject,
    html,
    attachments,
  })

  if (error) return { error }

  // Marquer les photos comme envoyées
  const now = new Date().toISOString()
  await supabase
    .from('chantier_photos')
    .update({ shared_with_client_at: now })
    .in('id', photoIds)
    .eq('chantier_id', chantierId)

  return { error: null, recipient }
}

function buildPhotosEmailHtml(ctx: {
  message: string
  recipientName: string
  chantierTitle: string
  orgName: string
  photoCount: number
}): string {
  const msgHtml = escHtml(ctx.message).replace(/\n/g, '<br>')
  const photoLabel = `${ctx.photoCount} photo${ctx.photoCount > 1 ? 's' : ''} jointe${ctx.photoCount > 1 ? 's' : ''} en pièce${ctx.photoCount > 1 ? 's' : ''} attachée${ctx.photoCount > 1 ? 's' : ''}.`
  const body = `
<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:0.8px;font-family:'Inter',sans-serif;">Photos de chantier</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3;letter-spacing:-0.04em;font-family:'Plus Jakarta Sans',sans-serif;">
  Bonjour${ctx.recipientName ? ' ' + escHtml(ctx.recipientName) : ''} !
</h1>
<p style="margin:0 0 24px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">${msgHtml}</p>
${renderInfoBox([{ label: 'Chantier', value: escHtml(ctx.chantierTitle), large: true }])}
<p style="margin:0;font-size:13px;color:#555555;line-height:1.5;font-family:'Inter',sans-serif;">${photoLabel}</p>`

  return renderEmailShell({
    title: `Photos du chantier : ${ctx.chantierTitle}`,
    headerName: ctx.orgName,
    bodyHtml: body,
  })
}
