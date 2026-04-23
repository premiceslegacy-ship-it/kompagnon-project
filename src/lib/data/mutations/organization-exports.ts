'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { sendAuthEmail } from '@/lib/email'
import { buildOrganizationExportReadyEmail } from '@/lib/email/templates'
import {
  buildOrganizationExportBundle,
  cleanupOrganizationExports,
} from '@/lib/organization-exports/build'
import {
  ORGANIZATION_EXPORT_BUCKET,
  ORGANIZATION_EXPORT_LINK_TTL_SECONDS,
  ORGANIZATION_EXPORT_RETENTION_DAYS,
} from '@/lib/organization-exports/shared'

export async function createOrganizationExport(): Promise<{ error: string | null; warning: string | null }> {
  const membership = await getCurrentMembershipContext()
  if (!membership?.organizationId || !membership.userId) {
    return { error: 'Organisation introuvable.', warning: null }
  }

  if (membership.roleSlug !== 'owner') {
    return { error: 'Seul l owner peut generer un export complet.', warning: null }
  }

  const admin = createAdminClient()
  const { data: organization } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', membership.organizationId)
    .single()

  if (!organization) {
    return { error: 'Organisation introuvable.', warning: null }
  }

  const { data: processingExport } = await admin
    .from('organization_exports')
    .select('id')
    .eq('organization_id', membership.organizationId)
    .eq('status', 'processing')
    .maybeSingle()

  if (processingExport?.id) {
    return { error: 'Un export est deja en cours. Attendez sa fin avant de relancer.', warning: null }
  }

  const { data: exportRow, error: insertError } = await admin
    .from('organization_exports')
    .insert({
      organization_id: membership.organizationId,
      requested_by_user_id: membership.userId,
      requested_by_email: membership.email ?? 'contact@orsayn.fr',
      status: 'processing',
      summary_json: { counts: {}, files: {}, warnings: [] },
    })
    .select('id')
    .single()

  if (insertError || !exportRow?.id) {
    console.error('[createOrganizationExport] insert:', insertError?.message)
    return { error: 'Impossible de lancer l export pour le moment.', warning: null }
  }

  let uploadedBundlePath: string | null = null

  try {
    const built = await buildOrganizationExportBundle({
      organizationId: membership.organizationId,
      exportId: exportRow.id,
    })

    const uploadResult = await admin.storage.from(ORGANIZATION_EXPORT_BUCKET).upload(built.bundlePath, built.buffer, {
      contentType: 'application/zip',
      upsert: true,
    })

    if (uploadResult.error) {
      throw new Error(uploadResult.error.message)
    }
    uploadedBundlePath = built.bundlePath

    const expiresAt = new Date(Date.now() + ORGANIZATION_EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    let finalSummary = built.summary

    const { data: signedData, error: signedError } = await admin.storage
      .from(ORGANIZATION_EXPORT_BUCKET)
      .createSignedUrl(built.bundlePath, ORGANIZATION_EXPORT_LINK_TTL_SECONDS)

    let warning: string | null = null
    if (signedError || !signedData?.signedUrl) {
      warning = "L'export a ete genere, mais le lien securise n'a pas pu etre prepare."
    } else if (!membership.email) {
      warning = "L'export a ete genere, mais aucun email owner n'est disponible pour l'envoi."
    } else {
      const { subject, html } = buildOrganizationExportReadyEmail({
        orgName: organization.name,
        downloadUrl: signedData.signedUrl,
        expiresAt,
        summary: finalSummary,
      })

      const emailResult = await sendAuthEmail({
        to: membership.email,
        subject,
        html,
      })

      if (emailResult.error) {
        warning = "L'export a ete genere, mais l'email de notification n'a pas pu etre envoye."
      }
    }

    if (warning) {
      finalSummary = {
        ...finalSummary,
        warnings: [...finalSummary.warnings, warning],
      }
    }

    await admin
      .from('organization_exports')
      .update({
        status: 'ready',
        bundle_path: built.bundlePath,
        bundle_size_bytes: built.sizeBytes,
        summary_json: finalSummary,
        completed_at: new Date().toISOString(),
        expires_at: expiresAt,
        error_message: null,
      })
      .eq('id', exportRow.id)

    await admin.from('activity_log').insert({
      organization_id: membership.organizationId,
      user_id: membership.userId,
      action: 'organization_export.ready',
      entity_type: 'organization_export',
      entity_id: exportRow.id,
      metadata: {
        bundle_path: built.bundlePath,
        bundle_size_bytes: built.sizeBytes,
      },
    })

    await cleanupOrganizationExports(admin, membership.organizationId)
    revalidatePath('/settings')
    return { error: null, warning }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    console.error('[createOrganizationExport]', message)

    if (uploadedBundlePath) {
      await admin.storage.from(ORGANIZATION_EXPORT_BUCKET).remove([uploadedBundlePath])
    }

    await admin
      .from('organization_exports')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportRow.id)

    await admin.from('activity_log').insert({
      organization_id: membership.organizationId,
      user_id: membership.userId,
      action: 'organization_export.failed',
      entity_type: 'organization_export',
      entity_id: exportRow.id,
      metadata: {
        error_message: message,
      },
    })

    revalidatePath('/settings')
    return { error: "L'export n'a pas pu etre genere.", warning: null }
  }
}
