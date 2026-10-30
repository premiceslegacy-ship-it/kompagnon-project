import { NextResponse } from 'next/server'
import { sanitizeFileName } from '@/lib/organization-exports/csv'

/**
 * Réponse PDF commune aux routes de documents.
 *
 * Deux propriétés sont portées ici plutôt que recopiées par route :
 * - `no-store` : une facture ou un contrat ne doit pas rester dans le cache
 *   d'un poste partagé ni d'un proxy ;
 * - nom de fichier assaini : `Content-Disposition` est un en-tête, un
 *   guillemet ou un caractère hors ByteString dans le nom casse la réponse.
 */
export function pdfResponse(
  buffer: Buffer | Uint8Array,
  fileName: string,
  options: { download: boolean; fallback?: string },
): NextResponse {
  const safeName = `${sanitizeFileName(fileName.replace(/\.pdf$/i, ''), options.fallback ?? 'document')}.pdf`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'Content-Disposition': `${options.download ? 'attachment' : 'inline'}; filename="${safeName}"`,
    },
  })
}
