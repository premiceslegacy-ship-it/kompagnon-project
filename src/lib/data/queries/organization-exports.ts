import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembershipContext } from './membership'
import { ORGANIZATION_EXPORT_BUCKET, ORGANIZATION_EXPORT_LINK_TTL_SECONDS, type OrganizationExportStatus } from '@/lib/organization-exports/shared'

export type OrganizationExportListItem = {
  id: string
  status: OrganizationExportStatus
  requestedByEmail: string
  bundleSizeBytes: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  warnings: string[]
  downloadUrl: string | null
}

export async function getOrganizationExports(): Promise<OrganizationExportListItem[]> {
  const membership = await getCurrentMembershipContext()
  if (!membership?.organizationId || membership.roleSlug !== 'owner') return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_exports')
    .select('id, status, requested_by_email, bundle_path, bundle_size_bytes, summary_json, error_message, created_at, completed_at, expires_at')
    .eq('organization_id', membership.organizationId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('[getOrganizationExports]', error.message)
    return []
  }

  const now = Date.now()

  return Promise.all(
    (data ?? []).map(async (row: any) => {
      const expiresAt = row.expires_at ?? null
      const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false
      let downloadUrl: string | null = null

      if (row.status === 'ready' && row.bundle_path && !expired) {
        const { data: signedData, error: signedError } = await admin.storage
          .from(ORGANIZATION_EXPORT_BUCKET)
          .createSignedUrl(row.bundle_path, ORGANIZATION_EXPORT_LINK_TTL_SECONDS)

        if (!signedError) {
          downloadUrl = signedData?.signedUrl ?? null
        }
      }

      return {
        id: row.id,
        status: expired && row.status === 'ready' ? 'expired' : row.status,
        requestedByEmail: row.requested_by_email,
        bundleSizeBytes: row.bundle_size_bytes ?? null,
        errorMessage: row.error_message ?? null,
        createdAt: row.created_at,
        completedAt: row.completed_at ?? null,
        expiresAt,
        warnings: Array.isArray(row.summary_json?.warnings) ? row.summary_json.warnings.filter((item: unknown) => typeof item === 'string') : [],
        downloadUrl,
      } satisfies OrganizationExportListItem
    }),
  )
}
