// Chargement des polices TTF pour embarquement pdf-lib (via @pdf-lib/fontkit).
// Cloudflare Workers n'a pas de filesystem au runtime : les TTF sont servis
// comme assets statiques du Worker (public/fonts/). Un fetch HTTP sortant vers
// le domaine public du Worker depuis son propre code timeout (erreur Cloudflare
// 522) — il faut passer par le binding ASSETS (env.ASSETS.fetch), le mécanisme
// prévu pour lire ses propres assets sans repasser par le réseau.
// Les bytes sont mis en cache au niveau module (survit entre requêtes sur la
// même isolate) pour éviter de re-fetcher à chaque génération de PDF.

const FONT_FILES = {
  interRegular: 'inter-regular.ttf',
  interBold: 'inter-bold.ttf',
  headingBold: 'plus-jakarta-sans-bold.ttf',
  headingXBold: 'plus-jakarta-sans-extrabold.ttf',
} as const

type FontKey = keyof typeof FONT_FILES

const bytesCache = new Map<FontKey, ArrayBuffer>()

async function fetchViaAssetsBinding(key: FontKey): Promise<ArrayBuffer | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    if (!env.ASSETS) return null
    const res = await env.ASSETS.fetch(new URL(`/fonts/${FONT_FILES[key]}`, 'http://assets.local'))
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

async function fetchFontBytes(origin: string, key: FontKey): Promise<ArrayBuffer> {
  const cached = bytesCache.get(key)
  if (cached) return cached

  const viaAssets = await fetchViaAssetsBinding(key)
  if (viaAssets) {
    bytesCache.set(key, viaAssets)
    return viaAssets
  }

  // Fallback (dev local sans binding ASSETS disponible) : fetch HTTP classique.
  const url = new URL(`/fonts/${FONT_FILES[key]}`, origin).toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Police introuvable : ${url} (${res.status})`)
  const bytes = await res.arrayBuffer()
  bytesCache.set(key, bytes)
  return bytes
}

export type FontBytes = {
  interRegular: ArrayBuffer
  interBold: ArrayBuffer
  headingBold: ArrayBuffer
  headingXBold: ArrayBuffer
}

export async function loadFontBytes(origin: string): Promise<FontBytes> {
  const [interRegular, interBold, headingBold, headingXBold] = await Promise.all([
    fetchFontBytes(origin, 'interRegular'),
    fetchFontBytes(origin, 'interBold'),
    fetchFontBytes(origin, 'headingBold'),
    fetchFontBytes(origin, 'headingXBold'),
  ])
  return { interRegular, interBold, headingBold, headingXBold }
}
