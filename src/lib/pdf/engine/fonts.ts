// Chargement des polices TTF pour embarquement pdf-lib (via @pdf-lib/fontkit).
// Cloudflare Workers n'a pas de filesystem au runtime, et un fetch (que ce soit
// vers le domaine public du Worker, ou via le binding ASSETS depuis du code
// applicatif hors du contexte direct du fetch handler top-level) s'est avéré
// non fiable en pratique — timeout 522 dans un cas, contexte ASSETS absent
// dans l'autre (voir historique commits). Les polices sont donc embarquées en
// base64 directement dans le bundle (src/lib/pdf/engine/font-data/), décodées
// une seule fois par isolate et mises en cache au niveau module.

import { inter_regular_base64 } from './font-data/inter-regular'
import { inter_bold_base64 } from './font-data/inter-bold'
import { plus_jakarta_sans_bold_base64 } from './font-data/plus-jakarta-sans-bold'
import { plus_jakarta_sans_extrabold_base64 } from './font-data/plus-jakarta-sans-extrabold'

export type FontBytes = {
  interRegular: ArrayBuffer
  interBold: ArrayBuffer
  headingBold: ArrayBuffer
  headingXBold: ArrayBuffer
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

let cached: FontBytes | null = null

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function loadFontBytes(_origin: string): Promise<FontBytes> {
  if (cached) return cached
  cached = {
    interRegular: base64ToArrayBuffer(inter_regular_base64),
    interBold: base64ToArrayBuffer(inter_bold_base64),
    headingBold: base64ToArrayBuffer(plus_jakarta_sans_bold_base64),
    headingXBold: base64ToArrayBuffer(plus_jakarta_sans_extrabold_base64),
  }
  return cached
}
