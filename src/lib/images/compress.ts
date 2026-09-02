/**
 * Recompresse une photo côté client avant upload : redimensionne et convertit en JPEG.
 * Évite les photos brutes de smartphone (3-8 Mo) qui gonflent le stockage et risquent
 * l'OOM lors de la génération PDF (embarquage base64 côté Worker, mémoire limitée).
 *
 * iOS Safari sait décoder le HEIC via createImageBitmap (conversion native du système),
 * donc ce chemin fonctionne aussi pour les photos prises directement avec l'appareil.
 * Si le décodage échoue (format vraiment non supporté par le navigateur), on rejette
 * avec un message clair plutôt que d'envoyer un fichier illisible côté serveur.
 */
export async function compressImageToJpeg(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {},
): Promise<File> {
  const maxDimension = opts.maxDimension ?? 1600
  const quality = opts.quality ?? 0.8

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Format de photo non pris en charge. Essayez d\'exporter en JPEG avant d\'importer.')
  }

  const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * ratio)
  const height = Math.round(bitmap.height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Compression indisponible sur cet appareil.')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Compression de la photo échouée.')

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}
