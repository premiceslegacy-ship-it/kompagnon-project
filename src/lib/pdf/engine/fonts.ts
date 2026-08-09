// Chargement des polices TTF pour embarquement pdf-lib (via @pdf-lib/fontkit).
// Cloudflare Workers n'a pas de filesystem au runtime : les TTF sont servis
// comme assets statiques du Worker (public/fonts/) et récupérés par fetch.
// Les bytes sont mis en cache au niveau module (survit entre requêtes sur la
// même isolate) pour éviter un fetch réseau à chaque génération de PDF.

const FONT_FILES = {
  interRegular: 'inter-regular.ttf',
  interBold: 'inter-bold.ttf',
  headingBold: 'plus-jakarta-sans-bold.ttf',
  headingXBold: 'plus-jakarta-sans-extrabold.ttf',
} as const

type FontKey = keyof typeof FONT_FILES

const bytesCache = new Map<FontKey, ArrayBuffer>()

async function fetchFontBytes(origin: string, key: FontKey): Promise<ArrayBuffer> {
  const cached = bytesCache.get(key)
  if (cached) return cached

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
