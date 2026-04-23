export const ORGANIZATION_EXPORT_BUCKET = 'organization-exports'
export const ORGANIZATION_EXPORT_RETENTION_DAYS = 30
export const ORGANIZATION_EXPORT_KEEP_COUNT = 3
export const ORGANIZATION_EXPORT_LINK_TTL_SECONDS = 60 * 60 * 24 * 7

export type OrganizationExportStatus = 'processing' | 'ready' | 'failed' | 'expired'

export type OrganizationExportSummary = {
  counts: Record<string, number>
  files: Record<string, number>
  warnings: string[]
}
