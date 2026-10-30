import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { logAuditEvent } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/**
 * Cron quotidien — exécute la suppression RGPD (art. 17) promise à J+30 par
 * requestAccountDeletion(). Anonymise les PII (profils, clients, membres
 * d'équipe) et désactive tous les accès ; conserve intégralement les factures,
 * devis et paiements (obligation de conservation fiscale 10 ans, CGI).
 *
 * Idempotent : l'anonymisation SQL et le nettoyage externe sont séparés. Les
 * organisations déjà anonymisées restent éligibles aux reprises même si leur
 * échéance a été effacée ; le marqueur de complétion évite tout faux succès.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

async function runJob(): Promise<NextResponse> {
  const admin = createAdminClient()

  const { data: dueOrgs, error } = await admin
    .from('organizations')
    .select('id, name')
    .is('deletion_cleanup_completed_at', null)
    .or(
      `anonymized_at.not.is.null,and(deletion_scheduled_at.not.is.null,deletion_scheduled_at.lte.${new Date().toISOString()})`,
    )
    .limit(50) // borné : un cron sans LIMIT peut saturer la mémoire

  if (error) {
    console.error('[cron/account-deletion] select', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  const errors: { orgId: string; error: string }[] = []

  for (const org of dueOrgs ?? []) {
    try {
      const { error: attachmentCutoverError } = await admin.rpc('assert_quote_attachment_cutover_complete')
      if (attachmentCutoverError) {
        errors.push({ orgId: org.id, error: `Quote attachment cutover incomplete: ${attachmentCutoverError.message}` })
        continue
      }
      const { data, error: rpcError } = await admin.rpc('anonymize_organization_for_deletion', {
        p_org_id: org.id,
      })
      if (rpcError) {
        errors.push({ orgId: org.id, error: rpcError.message })
        continue
      }
      const { data: persistedOrg, error: stateError } = await admin
        .from('organizations')
        .select('anonymized_at')
        .eq('id', org.id)
        .maybeSingle()
      if (stateError) throw new Error(`Unable to verify organization anonymization: ${stateError.message}`)
      if (!persistedOrg?.anonymized_at) {
        throw new Error('Organization was not anonymized; skipping external deletion cleanup')
      }
      const summary = Array.isArray(data) ? data[0] : data
      // The RPC revokes public capabilities and snapshots the original logo
      // URL before nulling it. External cleanup must finish before Auth deletion
      // or the completion marker, so every failure remains retryable.
      await purgeOrganizationStorage(admin, org.id)
      await purgeOrganizationLogo(admin, org.id)
      await deleteOrganizationAuthUsers(admin, org.id)

      const { data: completedOrg, error: completionError } = await admin
        .from('organizations')
        .update({ deletion_cleanup_completed_at: new Date().toISOString() })
        .eq('id', org.id)
        .is('deletion_cleanup_completed_at', null)
        .select('id')
        .maybeSingle()
      if (completionError) throw new Error(completionError.message)
      if (completedOrg) {
        processed++
        await logAuditEvent({
          organizationId: org.id,
          actorId: null,
          action: 'audit.organization.anonymized',
          entityType: 'organization',
          entityId: org.id,
          metadata: { org_name: org.name, ...summary },
        })
      } else {
        const { data: existing, error: readError } = await admin
          .from('organizations')
          .select('deletion_cleanup_completed_at')
          .eq('id', org.id)
          .maybeSingle()
        if (readError) throw new Error(readError.message)
        if (!existing?.deletion_cleanup_completed_at) {
          throw new Error('Account deletion cleanup completion marker was not persisted')
        }
      }
    } catch (err) {
      errors.push({ orgId: org.id, error: err instanceof Error ? err.message : 'unknown' })
    }
  }

  return NextResponse.json({ processed, errors })
}

const ORGANIZATION_STORAGE_BUCKETS = ['chantier-photos', 'organization-exports']

/**
 * Organization-owned objects use org-ID prefixes; quote request attachments
 * have their own immutable UUID namespace. Logos are owned by Auth identities.
 */
async function purgeOrganizationStorage(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<void> {
  for (const bucket of ORGANIZATION_STORAGE_BUCKETS) {
    const paths = await listStorageFilePaths(admin, bucket, orgId)
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
      if (error) throw new Error(`Unable to remove ${bucket}/${orgId}: ${error.message}`)
    }
  }

  const prefix = `quote-requests/${orgId}`
  const paths = await listStorageFilePaths(admin, 'quote-attachments', prefix)
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await admin.storage.from('quote-attachments').remove(paths.slice(offset, offset + 100))
    if (error) throw new Error(`Unable to remove quote-attachments/${prefix}: ${error.message}`)
  }
}

async function purgeOrganizationLogo(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<void> {
  const { data: manifest, error } = await admin
    .from('account_deletion_storage_manifests')
    .select('logo_url')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) throw new Error(`Unable to read original organization logo reference: ${error.message}`)
  if (!manifest) {
    throw new Error('Missing original logo cleanup manifest; legacy anonymized organization requires manual Storage reconciliation')
  }
  if (!manifest.logo_url) return

  const objectKey = await managedLogoObjectKey(admin, manifest.logo_url)
  if (!objectKey) return
  const objectPath = logoStoragePathFromManagedKey(objectKey)
  const uploaderId = objectPath.slice(0, objectPath.indexOf('/'))
  // The folder belongs to its uploader; retain it while that identity is active elsewhere.
  if (await hasOtherActiveMembership(admin, uploaderId, orgId)) return
  if (!await hasTargetOrganizationMembership(admin, orgId, uploaderId)) {
    const { data, error: lookupError } = await admin.auth.admin.getUserById(uploaderId)
    if (data?.user) return
    if (!isAuthUserNotFound(lookupError)) {
      const detail = lookupError instanceof Error
        ? lookupError.message
        : 'Auth lookup returned no user without a confirmed not-found response'
      throw new Error(`Unable to verify logo uploader ${uploaderId}: ${detail}`)
    }
  }
  const identityClaim = await claimAccountDeletionIdentity(admin, orgId, uploaderId)
  if (identityClaim === 'preserve') return
  if (identityClaim === 'ineligible') {
    throw new Error(`Unable to claim logo uploader ${uploaderId} for account deletion`)
  }

  const objectClaim = await claimAccountDeletionLogoObject(admin, orgId, objectKey)
  if (objectClaim === 'preserve') return
  if (objectClaim !== 'claimed') {
    throw new Error(`Unable to claim original logo object ${objectKey} for account deletion`)
  }

  const parentFolder = objectPath.slice(0, objectPath.lastIndexOf('/'))
  const existingPaths = await listStorageFilePaths(admin, 'logos', parentFolder)
  if (!existingPaths.includes(objectPath)) return

  const { error: removeError } = await admin.storage.from('logos').remove([objectPath])
  if (removeError) throw new Error(`Unable to remove original organization logo: ${removeError.message}`)
}

async function managedLogoObjectKey(
  admin: ReturnType<typeof createAdminClient>,
  logoUrl: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc('account_deletion_logo_object_key', {
    p_logo_url: logoUrl,
  })
  if (error) throw new Error(`Unable to normalize managed logo URL: ${error.message}`)
  if (data === null) return null
  if (typeof data !== 'string') throw new Error('Unexpected managed logo URL normalization result')
  const separator = data.indexOf('|')
  if (separator < 1 || data.indexOf('|', separator + 1) !== -1) {
    throw new Error('Invalid managed logo object key returned by database')
  }
  const localOrigin = new URL(
    admin.storage.from('logos').getPublicUrl('00000000-0000-0000-0000-000000000000/logo-origin-check').data.publicUrl,
  ).origin.toLowerCase()
  if (data.slice(0, separator) !== localOrigin) return null
  return data
}

function logoStoragePathFromManagedKey(objectKey: string): string {
  const separator = objectKey.indexOf('|')
  if (separator < 1 || objectKey.indexOf('|', separator + 1) !== -1) {
    throw new Error('Invalid managed logo object key')
  }
  return objectKey.slice(separator + 1)
}

async function claimAccountDeletionLogoObject(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  objectKey: string,
): Promise<'claimed' | 'preserve' | 'ineligible' | 'unmanaged'> {
  const { data, error } = await admin.rpc('claim_account_deletion_logo_object', {
    p_org_id: orgId,
    p_object_key: objectKey,
  })
  if (error) throw new Error(`Unable to claim logo object ${objectKey}: ${error.message}`)
  if (data !== 'claimed' && data !== 'preserve' && data !== 'ineligible' && data !== 'unmanaged') {
    throw new Error(`Unexpected account deletion logo claim result for ${objectKey}`)
  }
  return data
}


async function hasOtherActiveMembership(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)
    .neq('organization_id', orgId)
  if (error) throw new Error(`Unable to verify memberships for auth user ${userId}: ${error.message}`)
  if (count === null) throw new Error(`Unable to verify memberships for auth user ${userId}`)
  return count > 0
}

async function hasTargetOrganizationMembership(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('memberships')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`Unable to verify target-organization membership for logo uploader ${userId}: ${error.message}`)
  return Boolean(data)
}

function isAuthUserNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return ('status' in error && error.status === 404)
    || ('code' in error && error.code === 'user_not_found')
}

async function claimAccountDeletionIdentity(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  userId: string,
): Promise<'claimed' | 'preserve' | 'absent' | 'ineligible'> {
  const { data, error } = await admin.rpc('claim_account_deletion_identity', {
    p_org_id: orgId,
    p_user_id: userId,
  })
  if (error) throw new Error(`Unable to claim auth user ${userId} for deletion: ${error.message}`)
  if (data !== 'claimed' && data !== 'preserve' && data !== 'absent' && data !== 'ineligible') {
    throw new Error(`Unexpected account deletion claim result for auth user ${userId}`)
  }
  return data
}


async function listStorageFilePaths(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = []
  const visitedFolders = new Set<string>()

  async function collect(folder: string): Promise<void> {
    let offset = 0
    const nestedFolders: string[] = []
    while (true) {
      const { data: objects, error } = await admin.storage.from(bucket).list(folder, { limit: 1000, offset })
      if (error) throw new Error(`Unable to list ${bucket}/${folder}: ${error.message}`)
      const entries = objects ?? []
      for (const object of entries) {
        if (object.id === null) {
          const nested = `${folder}/${object.name}`
          if (!visitedFolders.has(nested)) {
            visitedFolders.add(nested)
            nestedFolders.push(nested)
          }
        } else {
          paths.push(`${folder}/${object.name}`)
        }
      }
      if (entries.length < 1000) break
      offset += entries.length
    }
    for (const nested of nestedFolders) await collect(nested)
  }

  visitedFolders.add(prefix)
  await collect(prefix)
  return paths
}

/**
 * Deletes target-organization Auth identities without an active membership
 * elsewhere, and clears each eligible user's private logo folder first.
 */
async function deleteOrganizationAuthUsers(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<void> {
  const { data: memberships, error: membershipError } = await admin
    .from('memberships')
    .select('user_id')
    .eq('organization_id', orgId)
  if (membershipError) throw new Error(`Unable to read organization memberships: ${membershipError.message}`)

  for (const userId of new Set((memberships ?? []).map((row) => row.user_id))) {
    if (await hasOtherActiveMembership(admin, userId, orgId)) continue

    const claim = await claimAccountDeletionIdentity(admin, orgId, userId)
    if (claim === 'preserve') continue
    if (claim === 'ineligible') {
      throw new Error(`Unable to claim auth user ${userId} for account deletion`)
    }

    // A missing Auth identity is safe, but its arbitrary old prefix is not an
    // immutable target manifest and therefore is not eligible for bulk purge.
    if (claim === 'absent') continue

    // Do this before Auth deletion: deleting auth.users cascades memberships,
    // so a failed purge must leave enough state for the next cron attempt.
    await purgePrivateUserStorage(admin, userId, orgId)

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      const authError = error as { status?: number; code?: string }
      if (authError.status !== 404 && authError.code !== 'user_not_found') {
        throw new Error(`Unable to delete auth user ${userId}: ${error.message}`)
      }
    }
  }
}

async function purgePrivateUserStorage(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  orgId: string,
): Promise<void> {
  const paths = await listStorageFilePaths(admin, 'logos', userId)
  const pathsToRemove: string[] = []

  for (const path of paths) {
    const publicUrl = admin.storage.from('logos').getPublicUrl(path).data.publicUrl
    const objectKey = await managedLogoObjectKey(admin, publicUrl)
    if (!objectKey || logoStoragePathFromManagedKey(objectKey) !== path) {
      throw new Error(`Unable to normalize private logo object ${path}`)
    }
    const claim = await claimAccountDeletionLogoObject(admin, orgId, objectKey)
    if (claim === 'preserve') continue
    if (claim !== 'claimed') {
      throw new Error(`Unable to claim private logo object ${path} for account deletion`)
    }
    pathsToRemove.push(path)
  }
  for (let offset = 0; offset < pathsToRemove.length; offset += 100) {
    const { error } = await admin.storage.from('logos').remove(pathsToRemove.slice(offset, offset + 100))
    if (error) throw new Error(`Unable to remove private logos/${userId}: ${error.message}`)
  }
}
